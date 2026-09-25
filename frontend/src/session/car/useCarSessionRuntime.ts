import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Choice, Session, TurnResult, FreeActionPreview, ImageReadyEvent } from '../../types';
import { apiFetch } from '../../lib/api';
import { requestActionPreview, type ClarificationThread } from '../../lib/previewAction';
import { useSessionEvents } from '../../hooks/useSessionEvents';
import { useSessionOperations } from '../useSessionOperations';
import { requestWrapUp } from '../adventureActions';
import { applySessionTension } from '../sessionAudio';
import { audioManager } from '../../audio/audioManager';

interface UseCarSessionRuntimeProps {
  sessionId: string;
  onTurnComplete: (session: Session, turn: TurnResult) => void;
  onTurnError: (error: string, message: string) => void;
  onConnected: () => void;
  onNarrating: () => void;
  onImageReady?: (imageUrl: string) => void;
  onPendingRollNarration?: (text: string) => void;
  onPreviewReady?: (preview: FreeActionPreview) => void;
  // The DM asked a question about the draft instead of previewing it.
  onClarification?: (question: string) => void;
  // A retryable explanation instead of a preview; the player tries again.
  onPreviewNotice?: (message: string) => void;
}

export function useCarSessionRuntime({
  sessionId,
  onTurnComplete,
  onTurnError,
  onConnected,
  onNarrating,
  onImageReady,
  onPendingRollNarration,
  onPreviewReady,
  onClarification,
  onPreviewNotice,
}: UseCarSessionRuntimeProps) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<TurnResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewThinking, setPreviewThinking] = useState(false);
  const [actionPreview, setActionPreview] = useState<FreeActionPreview | null>(null);
  const [clarification, setClarification] = useState<ClarificationThread | null>(null);
  const clarificationRef = useRef<ClarificationThread | null>(null);

  const prevEncounterStatusRef = useRef<'none' | 'active' | 'defeated' | 'fled' | 'surrendered' | 'resolved' | string>('none');
  const sessionRef = useRef<Session | null>(null);
  const loadingRef = useRef(true);
  const onTurnErrorRef = useRef(onTurnError);
  onTurnErrorRef.current = onTurnError;
  const lastPreviewRef = useRef<FreeActionPreview | null>(null);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    sessionRef.current = session;
    if (session?.encounterState?.status) {
      prevEncounterStatusRef.current = session.encounterState.status;
    } else if (session) {
      prevEncounterStatusRef.current = 'none';
    }
  }, [session]);

  // Operation lifecycle shared with the ordinary Session page. Every (re)connection
  // reconciles, so a missed event never strands the view or replays an action.
  const ops = useSessionOperations({
    sessionId,
    onSnapshot: snapshot => {
      setSession(snapshot.session);
      setHistory(snapshot.history);
    },
    setBusy: busy => {
      if (busy) {
        setLoading(true);
      }
    },
    isBusy: () => loadingRef.current,
    onWaitEnded: failed => {
      setLoading(false);
      if (failed) {
        const message = failed.errorMessage ?? 'Something went wrong. Please try again.';
        setActionError(message);
        onTurnErrorRef.current(failed.errorCode ?? 'turn_failed', message);
      }
    },
  });
  const { reconcile, noteRevision } = ops;

  const loadSession = useCallback(async () => {
    try {
      const res = await apiFetch(`/session/${sessionId}`);
      if (!res.ok) {
        navigate('/');
        return;
      }
      const data = await res.json();
      noteRevision(data.revision ?? 0);
      setSession(data);

      const hRes = await apiFetch(`/session/${sessionId}/history`);
      if (hRes.ok) {
        const hData = await hRes.json();
        setHistory(hData);
      }
    } catch (err) {
      console.error('[CarRuntime] Error loading session:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId, navigate, noteRevision]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const applyRecoveryTurn = (updatedSession: Session | null, turnResult: TurnResult | null, revision?: number) => {
    ops.onOperationEnded({ revision });
    if (updatedSession) {
      setSession(updatedSession);
    }
    setLoading(false);
    if (turnResult) {
      setHistory(prev => (turnResult.id && prev.some(t => t.id === turnResult.id) ? prev : [...prev, turnResult]));
      if (updatedSession) {
        onTurnComplete(updatedSession, turnResult);
      }
    }
  };

  const { connectionState } = useSessionEvents({
    sessionId,
    onConnected: () => {
      onConnected();
      void reconcile();
    },
    onSessionUpdated: (revision, changes) => {
      ops.noteRevision(revision);
      setSession(prev => prev ? { ...prev, ...changes, revision } : prev);
      // A preview computed against the old settings is no longer valid.
      lastPreviewRef.current = null;
      setActionPreview(null);
    },
    onGameOver: (updatedSession, meta) => {
      ops.onOperationEnded(meta);
      setSession(updatedSession);
    },
    onNarrating: () => {
      setLoading(true);
      onNarrating();
    },
    onRollNarrationDone: (rollNarration, actionResult) => {
      if (actionResult) {
        audioManager.playSfx('dice-roll');
        setTimeout(() => {
          if (actionResult.roll === 20) {
            audioManager.playSfx('roll-20');
          } else if (actionResult.success) {
            audioManager.playSfx('success-roll');
          } else {
            audioManager.playSfx('failed-roll');
          }
        }, 600);
      }
      if (rollNarration) {
        onPendingRollNarration?.(rollNarration);
      }
    },
    onTurnComplete: (updatedSession, turnResult, meta) => {
      const followUp = ops.onTurnCommitted(meta);
      applySessionTension(updatedSession, turnResult);
      setSession(updatedSession);
      if (turnResult) {
        setHistory(prev => (turnResult.id && prev.some(t => t.id === turnResult.id) ? prev : [...prev, turnResult]));
        // Stay busy while a rescue turn or the ending is still on its way.
        setLoading(followUp);
        onTurnComplete(updatedSession, turnResult);
      } else {
        void reconcile();
      }
    },
    onTurnError: (error, message, meta) => {
      ops.onOperationEnded(meta);
      setActionError(message);
      setLoading(false);
      onTurnError(error, message);
    },
    onImageReady: (event: ImageReadyEvent) => {
      if (event.target === 'scene') {
        onImageReady?.(event.imageUrl);
      } else if (event.target === 'character_avatar') {
        setSession(prev => prev ? {
          ...prev,
          party: prev.party.map(c => c.id === event.characterId ? { ...c, avatarUrl: event.imageUrl } : c),
        } : prev);
      }
    },
    onAdventureConcluding: () => {
      setLoading(true);
    },
    onAdventureConcluded: (updatedSession, turnResult, meta) => {
      // The ending is spoken/printed once like any turn; no choices follow it.
      applySessionTension(updatedSession, turnResult);
      applyRecoveryTurn(updatedSession, turnResult, meta?.revision);
    },
    onIntervention: (_narration, updatedSession, turnResult, meta) => {
      applyRecoveryTurn(updatedSession, turnResult, meta?.revision);
    },
    onSanctuaryRecovery: (_narration, updatedSession, turnResult, meta) => {
      applyRecoveryTurn(updatedSession, turnResult, meta?.revision);
    },
    onPartyUpdate: (updatedSession) => {
      if (updatedSession) {
        ops.noteRevision(updatedSession.revision);
        applySessionTension(updatedSession);
        setSession(updatedSession);
      }
    },
  });

  // choiceId is set only by submitChoice: a suggestion is selected explicitly, never by
  // text that happens to equal its label.
  const sendAction = useCallback(async (
    action: string,
    statUsed: string = 'none',
    difficulty: string = 'normal',
    difficultyValue: number | null = null,
    ownerCharId: string | null = null,
    itemId: string | null = null,
    targetCharId: string | null = null,
    actionIntent?: string,
    choiceId?: number,
  ) => {
    if (!session) {
      return;
    }
    setActionError(null);
    setLoading(true);
    setActionPreview(null);

    const actionType = itemId ? (action === 'use item' ? 'use_item' : 'give_item') : undefined;
    // Confirming the last preview sends its server handle so mechanics are verified.
    const lastPreview = lastPreviewRef.current;
    const previewId = choiceId === undefined && lastPreview && (lastPreview.interpretedAction === action || lastPreview.originalAction === action)
      ? lastPreview.previewId
      : undefined;
    lastPreviewRef.current = null;

    try {
      const result = await ops.submit(`/session/${sessionId}/action`, {
        action,
        statUsed,
        difficulty,
        difficultyValue,
        characterId: ownerCharId ?? undefined,
        actionType,
        itemId: itemId ?? undefined,
        targetCharacterId: targetCharId ?? undefined,
        ...(actionIntent && { actionIntent }),
        ...(previewId && { previewId }),
        ...(choiceId !== undefined && { choiceId }),
      });
      if (result.kind === 'accepted') {
        return;
      }
      // Conflicts refresh the snapshot inside ops.submit.
      setActionError(result.message);
      setLoading(false);
      onTurnError(result.error, result.message);
    } catch {
      const msg = 'Could not reach the realm. Check your connection and try again.';
      setActionError(msg);
      setLoading(false);
      onTurnError('turn_failed', msg);
    }
  }, [session, sessionId, onTurnError, ops]);

  const submitAction = useCallback((
    action: string,
    statUsed?: string,
    difficulty?: string,
    difficultyValue?: number | null,
    ownerCharId?: string | null,
    itemId?: string | null,
    targetCharId?: string | null,
    actionIntent?: string,
  ) => sendAction(action, statUsed, difficulty, difficultyValue, ownerCharId, itemId, targetCharId, actionIntent), [sendAction]);

  const submitChoice = useCallback((choice: Choice) => (
    sendAction(choice.label, choice.stat, choice.difficulty, choice.difficultyValue ?? null, null, null, null, undefined, choice.id)
  ), [sendAction]);

  // Session-management commands (spoken in car mode, typed in the terminal).
  const wrapUpAdventure = useCallback(async (): Promise<string | null> => {
    const result = await requestWrapUp(sessionId, ops.revisionRef.current);
    if (!result.ok) {
      return result.message;
    }
    ops.noteRevision(result.revision);
    setSession(prev => prev && result.adventure ? { ...prev, adventure: result.adventure, revision: result.revision } : prev);
    return null;
  }, [sessionId, ops]);

  const endAdventure = useCallback(async (): Promise<string | null> => {
    setLoading(true);
    const result = await ops.submit(`/session/${sessionId}/adventure/end`, {}, { expectsFollowUp: true });
    if (result.kind === 'accepted') {
      return null;
    }
    setLoading(false);
    return result.message;
  }, [sessionId, ops]);

  // Previews typed or spoken text. With an open DM question, the text is the reply and
  // is sent together with the original draft.
  const previewAction = useCallback(async (actionText: string) => {
    if (!session) {
      return;
    }
    setPreviewThinking(true);
    setActionError(null);

    const result = await requestActionPreview(sessionId, actionText, clarificationRef.current);
    if (result.kind === 'clarification') {
      clarificationRef.current = result.thread;
      setClarification(result.thread);
      setPreviewThinking(false);
      onClarification?.(result.thread.question);
      return;
    }
    clarificationRef.current = null;
    setClarification(null);
    if (result.kind === 'error') {
      setPreviewThinking(false);
      onPreviewNotice?.(result.message);
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
    onPreviewReady?.(preview);
  }, [session, sessionId, onPreviewReady, onClarification, onPreviewNotice]);

  // Drops an open DM question ("cancel", "never mind"); the player starts a new draft.
  const clearClarification = useCallback(() => {
    clarificationRef.current = null;
    setClarification(null);
  }, []);

  // Hides the preview UI. The server handle is kept until the next submission so a
  // confirm flow that clears the preview before submitting still sends it.
  const clearPreview = useCallback(() => {
    setActionPreview(null);
  }, []);

  return {
    session,
    history,
    loading,
    actionError,
    setActionError,
    connectionState,
    prevEncounterStatus: prevEncounterStatusRef.current,
    submitAction,
    submitChoice,
    previewAction,
    wrapUpAdventure,
    endAdventure,
    // Explicit operation lifecycle (idle / submitting / resolving / following_up),
    // independent of connectionState.
    operationPhase: ops.phase,
    actionPreview,
    clearPreview,
    previewThinking,
    clarification,
    clearClarification,
  };
}
