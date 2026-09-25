import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActionAttempt, FreeActionPreview, HpChange, IdeasPayload, ImageReadyEvent, Session, SessionOperation, SessionSnapshot, TurnResult } from '../types';
import { apiFetch } from '../lib/api';
import { patchEncounterAreaImage, patchEncounterEnemyAvatar } from '../lib/encounters';
import { applyIdeasPayload, currentIdeas, fetchIdeas, type IdeasRequestResult } from '../lib/ideas';
import { requestActionPreview, type ClarificationThread } from '../lib/previewAction';
import { useSessionEvents, type NarratingPayload, type OperationEventMeta } from '../hooks/useSessionEvents';
import { useAutoIdeas } from './useAutoIdeas';
import { useSessionOperations } from './useSessionOperations';

// One turn lifecycle for every presentation (Session page, car, terminal). Connection
// state is separate: a reconnect is not a turn.
//   initializing - the session is not loaded yet
//   ready        - input accepted
//   previewing   - the DM is reading a draft (preview request in flight)
//   confirming   - a preview waits for the player to confirm, edit or cancel
//   submitting   - the action is on its way, not yet accepted
//   resolving    - accepted; the DM is narrating
//   revealing    - the dice are known, the consequences are still being narrated
//   presenting   - the turn is committed; the view is still showing the roll
//   recovering   - the same operation continues with a rescue turn or the ending
// Adventure completion is not a turn phase: read it from `session.adventure`.
export type TurnPhase =
  | 'initializing'
  | 'ready'
  | 'previewing'
  | 'confirming'
  | 'submitting'
  | 'resolving'
  | 'revealing'
  | 'presenting'
  | 'recovering';

const BUSY_PHASES: ReadonlySet<TurnPhase> = new Set(['submitting', 'resolving', 'revealing', 'presenting', 'recovering']);

export const isTurnPhaseBusy = (phase: TurnPhase): boolean => BUSY_PHASES.has(phase);

export type FollowUpTurnKind = 'intervention' | 'sanctuary' | 'conclusion';

export type SubmitTurnInput = {
  action: string;
  statUsed?: string;
  difficulty?: string;
  difficultyValue?: number | null;
  characterId?: string | null;
  itemId?: string | null;
  targetCharacterId?: string | null;
  actionIntent?: string;
  previewId?: string;
  // Set only when a suggestion is picked explicitly, never inferred from matching text.
  choiceId?: number;
};

export type SubmitTurnResult = { ok: true } | { ok: false; error: string; message: string };

export type ScenePreviewRequest = {
  action?: string;
  intent?: string;
  targetCharacterId?: string;
  itemOwnerCharacterId?: string;
  itemId?: string;
  method?: string;
};

// Presentation hooks. The runtime owns data and the lifecycle; views decide what to
// show, play or say. All are optional.
export interface SessionRuntimePresenter {
  // History was (re)loaded: the first load, or a reconciliation snapshot.
  onHistoryLoaded?: (history: TurnResult[], info: { initial: boolean; wasEmpty: boolean; latestChanged: boolean; session: Session }) => void;
  // A committed turn joined the history (regular, rescue or ending).
  onTurnAppended?: (turn: TurnResult, index: number) => void;
  onConnected?: () => void;
  onNarrating?: (payload: NarratingPayload) => void;
  onNarrationChunk?: (text: string, field: 'rollNarration' | 'narration') => void;
  onRollRevealed?: (rollNarration: string | null, actionResult?: ActionAttempt['actionResult'], hpChanges?: HpChange[]) => void;
  onNarrationStreamingDone?: (narration: string, rollNarration: string | null) => void;
  onNarrationChunkAbort?: () => void;
  // A regular turn committed. Return a number of milliseconds to keep the view in
  // `presenting` (e.g. while the roll stays on screen); input stays locked meanwhile.
  onTurnComplete?: (session: Session, turn: TurnResult | null, info: { followUp: boolean }) => number | void;
  // A rescue turn or the adventure's ending, closing the operation.
  onFollowUpTurn?: (kind: FollowUpTurnKind, narration: string | null, session: Session | null, turn: TurnResult | null) => void;
  onTurnError?: (error: string, message: string) => void;
  // A turn this view waited on finished while its events were missed.
  onWaitEnded?: (failed: SessionOperation | null) => void;
  onImageReady?: (event: ImageReadyEvent) => void;
  onPartyUpdate?: (session: Session | null) => void;
  onAdventureConcluding?: () => void;
  onGameOver?: (session: Session) => void;
  // Results of previewAction (typed or spoken drafts).
  onPreviewReady?: (preview: FreeActionPreview) => void;
  onClarification?: (question: string) => void;
  onPreviewNotice?: (message: string) => void;
}

export interface UseSessionRuntimeOptions {
  sessionId: string;
  presenter?: SessionRuntimePresenter;
  // Ask for ideas once by itself while the realm is in onboarding.
  onboardingIdeas?: boolean;
}

const PREVIEW_FAILED_WARNING = 'Preview failed - submitting with default stat. You can still confirm or cancel.';

export function useSessionRuntime({ sessionId, presenter = {}, onboardingIdeas = false }: UseSessionRuntimeOptions) {
  const navigate = useNavigate();
  // SSE handlers are registered once per session, so presentation hooks are read from a ref.
  const presenterRef = useRef(presenter);
  useEffect(() => {
    presenterRef.current = presenter;
  });

  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistoryState] = useState<TurnResult[]>([]);
  // Mirrors history between renders: two events can arrive before React re-renders.
  const historyRef = useRef<TurnResult[]>([]);
  const commitHistory = useCallback((next: TurnResult[]) => {
    historyRef.current = next;
    setHistoryState(next);
  }, []);

  const [actionError, setActionError] = useState<string | null>(null);
  const [rollRevealed, setRollRevealed] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const presentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [previewThinking, setPreviewThinking] = useState(false);
  const [actionPreview, setActionPreview] = useState<FreeActionPreview | null>(null);
  // The server handle of the last preview; kept after the preview UI closes so a
  // confirm flow that hides it before submitting still sends it.
  const lastPreviewRef = useRef<FreeActionPreview | null>(null);
  const [clarification, setClarification] = useState<ClarificationThread | null>(null);
  const clarificationRef = useRef<ClarificationThread | null>(null);

  const stopPresenting = useCallback(() => {
    if (presentTimerRef.current) {
      clearTimeout(presentTimerRef.current);
      presentTimerRef.current = null;
    }
    setPresenting(false);
  }, []);

  const presentFor = useCallback((ms: number) => {
    if (presentTimerRef.current) {
      clearTimeout(presentTimerRef.current);
    }
    setPresenting(true);
    presentTimerRef.current = setTimeout(() => {
      presentTimerRef.current = null;
      setPresenting(false);
    }, ms);
  }, []);

  useEffect(() => () => {
    if (presentTimerRef.current) {
      clearTimeout(presentTimerRef.current);
    }
  }, []);

  const resetTurnFlags = useCallback(() => {
    setRollRevealed(false);
    stopPresenting();
  }, [stopPresenting]);

  const loadHistory = useCallback((nextHistory: TurnResult[], nextSession: Session, initial: boolean) => {
    const prev = historyRef.current;
    const wasEmpty = prev.length === 0;
    if (nextHistory.length === 0 && !wasEmpty) {
      return;
    }
    const latestChanged = prev.length !== nextHistory.length || prev[prev.length - 1]?.id !== nextHistory[nextHistory.length - 1]?.id;
    commitHistory(nextHistory);
    presenterRef.current.onHistoryLoaded?.(nextHistory, { initial, wasEmpty, latestChanged, session: nextSession });
  }, [commitHistory]);

  const ops = useSessionOperations({
    sessionId,
    onSnapshot: (snapshot: SessionSnapshot) => {
      setSession(snapshot.session);
      loadHistory(snapshot.history, snapshot.session, false);
    },
    onWaitEnded: failed => {
      resetTurnFlags();
      if (failed) {
        setActionError(failed.errorMessage ?? 'Something went wrong. Please try again.');
      }
      presenterRef.current.onWaitEnded?.(failed);
    },
  });
  const { noteRevision, reconcile } = ops;

  // initial: the first load of this view (a reload after a party change is not).
  const load = useCallback(async (initial: boolean) => {
    try {
      const res = await apiFetch(`/session/${sessionId}`);
      if (!res.ok) {
        navigate('/');
        return;
      }
      const data = await res.json() as Session;
      noteRevision(data.revision ?? 0);
      const hRes = await apiFetch(`/session/${sessionId}/history`);
      const hData = hRes.ok ? await hRes.json() as TurnResult[] : [];
      loadHistory(hData, data, initial);
      setSession(data);
    } catch (err) {
      console.error('[SessionRuntime] Error loading session:', err);
    }
  }, [sessionId, navigate, noteRevision, loadHistory]);

  useEffect(() => {
    void load(true);
  }, [load]);

  const appendTurn = useCallback((turn: TurnResult) => {
    const prev = historyRef.current;
    if (turn.id && prev.some(t => t.id === turn.id)) {
      return;
    }
    const next = [...prev, turn];
    commitHistory(next);
    presenterRef.current.onTurnAppended?.(turn, next.length - 1);
  }, [commitHistory]);

  const applyIdeas = useCallback((payload: IdeasPayload) => {
    commitHistory(applyIdeasPayload(historyRef.current, payload));
  }, [commitHistory]);

  const dropPreview = useCallback(() => {
    lastPreviewRef.current = null;
    setActionPreview(null);
  }, []);

  const applyFollowUpTurn = (kind: FollowUpTurnKind, narration: string | null, updatedSession: Session | null, turn: TurnResult | null, meta?: OperationEventMeta) => {
    ops.onOperationEnded(meta);
    resetTurnFlags();
    if (updatedSession) {
      setSession(updatedSession);
    }
    if (turn) {
      appendTurn(turn);
    }
    presenterRef.current.onFollowUpTurn?.(kind, narration, updatedSession, turn);
  };

  const { connectionState } = useSessionEvents({
    sessionId,
    onConnected: () => {
      presenterRef.current.onConnected?.();
      void reconcile();
    },
    // Ideas for a turn, requested here or by another viewer. Idempotent.
    onIdeasUpdated: applyIdeas,
    onSessionUpdated: (revision, changes) => {
      ops.noteRevision(revision);
      setSession(prev => prev ? { ...prev, ...changes, revision } : prev);
      // A preview computed against the old settings is no longer valid.
      dropPreview();
    },
    onGameOver: (updatedSession, meta) => {
      ops.onOperationEnded(meta);
      resetTurnFlags();
      setSession(updatedSession);
      presenterRef.current.onGameOver?.(updatedSession);
    },
    onNarrating: payload => {
      // Also covers turns other viewers submitted: every view locks while the DM narrates.
      ops.onRemoteOperation();
      presenterRef.current.onNarrating?.(payload);
    },
    onNarrationChunk: (text, field) => {
      presenterRef.current.onNarrationChunk?.(text, field);
    },
    onRollNarrationDone: (rollNarration, actionResult, hpChanges) => {
      if (actionResult && actionResult.statUsed !== 'none') {
        setRollRevealed(true);
      }
      presenterRef.current.onRollRevealed?.(rollNarration, actionResult, hpChanges);
    },
    onNarrationStreamingDone: (narration, rollNarration) => {
      presenterRef.current.onNarrationStreamingDone?.(narration, rollNarration);
    },
    onNarrationChunkAbort: () => {
      // The roll stays valid; only the narration is retrying.
      presenterRef.current.onNarrationChunkAbort?.();
    },
    onTurnComplete: (updatedSession, turn, meta) => {
      // Stays locked when a rescue turn or the ending still follows in the same operation.
      const followUp = ops.onTurnCommitted(meta);
      setRollRevealed(false);
      if (updatedSession) {
        setSession(updatedSession);
      }
      if (turn) {
        appendTurn(turn);
      }
      const holdMs = presenterRef.current.onTurnComplete?.(updatedSession, turn, { followUp });
      if (typeof holdMs === 'number' && holdMs > 0) {
        presentFor(holdMs);
      }
      if (!turn) {
        void reconcile();
      }
    },
    onTurnError: (error, message, meta) => {
      ops.onOperationEnded(meta);
      resetTurnFlags();
      setActionError(message);
      presenterRef.current.onTurnError?.(error, message);
    },
    onImageReady: event => {
      if (event.target === 'scene') {
        const idx = historyRef.current.findIndex(t => t.id === event.turnId);
        if (idx !== -1) {
          const next = [...historyRef.current];
          next[idx] = { ...next[idx], imageUrl: event.imageUrl };
          commitHistory(next);
        }
      } else if (event.target === 'encounter_enemy') {
        setSession(prev => prev ? patchEncounterEnemyAvatar(prev, event.encounterId, event.enemyId, event.imageUrl) : prev);
      } else if (event.target === 'encounter_area') {
        setSession(prev => prev ? patchEncounterAreaImage(prev, event.encounterId, event.areaId, event.imageUrl) : prev);
      } else if (event.target === 'character_avatar') {
        setSession(prev => prev ? {
          ...prev,
          party: prev.party.map(c => c.id === event.characterId ? { ...c, avatarUrl: event.imageUrl } : c),
        } : prev);
      }
      presenterRef.current.onImageReady?.(event);
    },
    onAdventureConcluding: () => {
      ops.onRemoteOperation(true);
      presenterRef.current.onAdventureConcluding?.();
    },
    onAdventureConcluded: (updatedSession, turn, meta) => {
      applyFollowUpTurn('conclusion', null, updatedSession, turn, meta);
    },
    onIntervention: (narration, updatedSession, turn, meta) => {
      applyFollowUpTurn('intervention', narration, updatedSession, turn, meta);
    },
    onSanctuaryRecovery: (narration, updatedSession, turn, meta) => {
      applyFollowUpTurn('sanctuary', narration, updatedSession, turn, meta);
    },
    onPartyUpdate: updatedSession => {
      if (updatedSession) {
        ops.noteRevision(updatedSession.revision);
        setSession(updatedSession);
      } else {
        void load(false);
      }
      presenterRef.current.onPartyUpdate?.(updatedSession);
    },
  });

  // Plays an action. A conflict refreshes the snapshot; the view keeps its draft.
  const submitTurn = useCallback(async (input: SubmitTurnInput): Promise<SubmitTurnResult> => {
    setActionError(null);
    setActionPreview(null);
    const { action, itemId, choiceId } = input;
    const actionType = itemId ? (action === 'use item' ? 'use_item' : 'give_item') : undefined;
    // Confirming the last preview sends its server handle so mechanics are verified.
    const lastPreview = lastPreviewRef.current;
    const previewId = input.previewId ?? (choiceId === undefined && lastPreview && (lastPreview.interpretedAction === action || lastPreview.originalAction === action)
      ? lastPreview.previewId
      : undefined);
    lastPreviewRef.current = null;
    try {
      const result = await ops.submit(`/session/${sessionId}/action`, {
        action,
        statUsed: input.statUsed ?? 'none',
        difficulty: input.difficulty ?? 'normal',
        difficultyValue: input.difficultyValue ?? null,
        characterId: input.characterId ?? undefined,
        actionType,
        itemId: itemId ?? undefined,
        targetCharacterId: input.targetCharacterId ?? undefined,
        ...(input.actionIntent && { actionIntent: input.actionIntent }),
        ...(previewId && { previewId }),
        ...(choiceId !== undefined && { choiceId }),
      });
      if (result.kind === 'accepted') {
        // The outcome arrives via turn_complete (or turn_error).
        return { ok: true };
      }
      setActionError(result.message);
      return { ok: false, error: result.error, message: result.message };
    } catch {
      const message = 'Could not reach the realm. Check your connection and try again.';
      setActionError(message);
      return { ok: false, error: 'turn_failed', message };
    }
  }, [sessionId, ops]);

  // Session-level operations (end here, continue the world). Returns the refusal
  // message, or null once accepted.
  const submitOperation = useCallback(async (path: string, body: Record<string, unknown> = {}, options: { expectsFollowUp?: boolean } = {}): Promise<string | null> => {
    setActionError(null);
    const result = await ops.submit(`/session/${sessionId}${path}`, body, options);
    return result.kind === 'accepted' ? null : result.message;
  }, [sessionId, ops]);

  // Local patch after a guarded settings mutation (or a view-only toggle).
  const updateSession = useCallback((patch: Partial<Session>, revision?: number) => {
    noteRevision(revision);
    setSession(prev => prev ? { ...prev, ...patch, ...(revision !== undefined && { revision: Math.max(prev.revision ?? 0, revision) }) } : prev);
  }, [noteRevision]);

  // Previews typed or spoken text. With an open DM question, the text is the reply and
  // is sent together with the original draft.
  const sessionLoaded = !!session;
  const previewAction = useCallback(async (actionText: string) => {
    if (!sessionLoaded) {
      return;
    }
    setPreviewThinking(true);
    setActionError(null);

    const result = await requestActionPreview(sessionId, actionText, clarificationRef.current);
    if (result.kind === 'clarification') {
      clarificationRef.current = result.thread;
      setClarification(result.thread);
      setPreviewThinking(false);
      presenterRef.current.onClarification?.(result.thread.question);
      return;
    }
    clarificationRef.current = null;
    setClarification(null);
    if (result.kind === 'error') {
      setPreviewThinking(false);
      presenterRef.current.onPreviewNotice?.(result.message);
      return;
    }

    const draft = result.originalDraft;
    const fallback: FreeActionPreview = { originalAction: draft, interpretedAction: draft, stat: 'mischief', difficulty: 'normal', warnings: [] };
    const preview: FreeActionPreview = result.kind === 'preview'
      ? {
        ...fallback,
        ...result.preview,
        originalAction: draft,
        interpretedAction: result.preview.interpretedAction ?? draft,
        warnings: result.preview.warnings ?? [],
      }
      : { ...fallback, warnings: ['Preview failed - you can still confirm or cancel.'] };
    lastPreviewRef.current = preview;
    setActionPreview(preview);
    setPreviewThinking(false);
    presenterRef.current.onPreviewReady?.(preview);
  }, [sessionLoaded, sessionId]);

  // Previews a structured scene action (gear, bless, aid, rally). `defaults` fill in
  // what the preview does not return, so a failed preview can still be confirmed.
  const previewSceneAction = useCallback(async (
    request: ScenePreviewRequest,
    defaults: Partial<FreeActionPreview> = {},
    fallbackAction = request.action ?? 'Try a support action for the current situation',
  ) => {
    const actionText = request.action ?? fallbackAction;
    let preview: FreeActionPreview = {
      originalAction: actionText,
      interpretedAction: actionText,
      stat: 'mischief',
      difficulty: 'normal',
      warnings: [],
      ...defaults,
    };
    setActionError(null);
    setPreviewThinking(true);
    try {
      const res = await apiFetch(`/session/${sessionId}/preview-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (res.ok) {
        const responsePreview = await res.json() as Partial<FreeActionPreview>;
        preview = {
          ...preview,
          ...responsePreview,
          originalAction: responsePreview.originalAction ?? actionText,
          interpretedAction: responsePreview.interpretedAction ?? actionText,
          warnings: responsePreview.warnings ?? [],
          choiceItemBonus: responsePreview.choiceItemBonus ?? preview.choiceItemBonus,
          choiceItemName: responsePreview.choiceItemName ?? preview.choiceItemName,
          choiceItemOwnerName: responsePreview.choiceItemOwnerName ?? preview.choiceItemOwnerName,
          flavor: responsePreview.flavor ?? preview.flavor,
        };
      } else {
        preview = { ...preview, warnings: [PREVIEW_FAILED_WARNING] };
      }
    } catch {
      preview = { ...preview, warnings: [PREVIEW_FAILED_WARNING] };
    }
    const scenePreview: FreeActionPreview = {
      ...preview,
      ...(request.intent && { pendingIntent: request.intent }),
      ...(request.targetCharacterId && { pendingTargetCharacterId: request.targetCharacterId }),
    };
    lastPreviewRef.current = scenePreview;
    setActionPreview(scenePreview);
    setPreviewThinking(false);
  }, [sessionId]);

  // Hides the preview UI; the server handle is kept until the next submission.
  const clearPreview = useCallback(() => {
    setActionPreview(null);
  }, []);

  // Cancels the preview: nothing of it is sent with a later action.
  const dismissPreview = dropPreview;

  // Drops an open DM question ("cancel", "never mind"); the player starts a new draft.
  const clearClarification = useCallback(() => {
    clarificationRef.current = null;
    setClarification(null);
  }, []);

  const turnPhase: TurnPhase = !session
    ? 'initializing'
    : ops.phase === 'submitting'
      ? 'submitting'
      : ops.phase === 'following_up'
        ? 'recovering'
        : ops.phase === 'resolving'
          ? (rollRevealed ? 'revealing' : 'resolving')
          : presenting
            ? 'presenting'
            : previewThinking
              ? 'previewing'
              : actionPreview
                ? 'confirming'
                : 'ready';
  const busy = isTurnPhaseBusy(turnPhase);

  // Current ideas for the latest turn (hidden once stale), and a way to ask for them.
  const latestTurn = history[history.length - 1] ?? null;
  const ideas = useMemo(
    () => currentIdeas(latestTurn, { revision: session?.revision, activeCharacterId: session?.activeCharacterId }),
    [latestTurn, session?.revision, session?.activeCharacterId],
  );
  // Realm setting "Suggest ideas each turn".
  useAutoIdeas({ sessionId, session, latestTurn, busy, onIdeas: applyIdeas });

  // Onboarding asks for ideas once by itself, after the opening scene. Typing stays
  // available meanwhile; a refusal (another viewer asked first) is silent.
  const onboardingIdeasAskedRef = useRef(false);
  const onboardingPending = onboardingIdeas && !!session?.onboardingIdeasPending;
  const latestTurnId = latestTurn?.id;
  const sessionRevision = session?.revision;
  const hasIdeas = ideas.length > 0;
  useEffect(() => {
    if (!onboardingPending || onboardingIdeasAskedRef.current || busy || !latestTurnId || hasIdeas) {
      return;
    }
    onboardingIdeasAskedRef.current = true;
    void fetchIdeas(sessionId, { turnId: latestTurnId, revision: sessionRevision ?? 0, reason: 'onboarding_auto' }).then(result => {
      if (result.kind === 'ideas') {
        applyIdeas(result.payload);
      }
    });
  }, [onboardingPending, busy, latestTurnId, hasIdeas, sessionId, sessionRevision, applyIdeas]);

  const requestIdeas = useCallback(async (retry = false): Promise<IdeasRequestResult> => {
    if (!latestTurnId || sessionRevision === undefined) {
      return { kind: 'error', error: 'no_turn', message: 'The story has not started yet.' };
    }
    const result = await fetchIdeas(sessionId, { turnId: latestTurnId, revision: sessionRevision, ...(retry && { retry: true }) });
    if (result.kind === 'ideas') {
      applyIdeas(result.payload);
    }
    return result;
  }, [latestTurnId, sessionRevision, sessionId, applyIdeas]);

  return {
    session,
    history,
    latestTurn,
    connectionState,
    turnPhase,
    busy,
    // Operation phase from the shared operations hook (idle / submitting / resolving / following_up).
    operationPhase: ops.phase,
    revisionRef: ops.revisionRef,
    actionError,
    setActionError,
    reload: () => load(false),
    updateSession,
    submitTurn,
    submitOperation,
    previewAction,
    previewSceneAction,
    actionPreview,
    clearPreview,
    dismissPreview,
    previewThinking,
    clarification,
    clearClarification,
    ideas,
    applyIdeas,
    requestIdeas,
  };
}

export type SessionRuntime = ReturnType<typeof useSessionRuntime>;
