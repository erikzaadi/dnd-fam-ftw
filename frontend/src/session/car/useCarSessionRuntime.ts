import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session, TurnResult, FreeActionPreview, ImageReadyEvent } from '../../types';
import { apiFetch } from '../../lib/api';
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
}: UseCarSessionRuntimeProps) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<TurnResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewThinking, setPreviewThinking] = useState(false);
  const [actionPreview, setActionPreview] = useState<FreeActionPreview | null>(null);

  const prevEncounterStatusRef = useRef<'none' | 'active' | 'defeated' | 'fled' | 'surrendered' | 'resolved' | string>('none');
  const sessionRef = useRef<Session | null>(null);
  const historyRef = useRef<TurnResult[]>([]);
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

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

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

  const submitAction = useCallback(async (
    action: string,
    statUsed: string = 'none',
    difficulty: string = 'normal',
    difficultyValue: number | null = null,
    ownerCharId: string | null = null,
    itemId: string | null = null,
    targetCharId: string | null = null,
    actionIntent?: string
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
    const previewId = lastPreview && (lastPreview.interpretedAction === action || lastPreview.originalAction === action)
      ? lastPreview.previewId
      : undefined;
    lastPreviewRef.current = null;
    // Suggested choices are submitted by their stable id from the latest turn.
    const latestChoices = historyRef.current[historyRef.current.length - 1]?.choices ?? [];
    const choiceId = itemId ? undefined : latestChoices.find(choice => choice.label === action)?.id;

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

  const previewAction = useCallback(async (actionText: string) => {
    if (!session) {
      return;
    }
    setPreviewThinking(true);
    setActionError(null);

    let preview: FreeActionPreview = {
      originalAction: actionText,
      interpretedAction: actionText,
      stat: 'mischief',
      difficulty: 'normal',
      warnings: [],
    };

    try {
      const res = await apiFetch(`/session/${sessionId}/preview-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: actionText }),
      });
      if (res.ok) {
        const responsePreview = await res.json();
        preview = {
          ...preview,
          ...responsePreview,
          originalAction: responsePreview.originalAction ?? actionText,
          interpretedAction: responsePreview.interpretedAction ?? actionText,
          warnings: responsePreview.warnings ?? [],
        };
      } else {
        preview = {
          ...preview,
          warnings: ['Preview failed - you can still confirm or cancel.'],
        };
      }
    } catch {
      preview = {
        ...preview,
        warnings: ['Preview failed - you can still confirm or cancel.'],
      };
    } finally {
      lastPreviewRef.current = preview;
      setActionPreview(preview);
      setPreviewThinking(false);
      onPreviewReady?.(preview);
    }
  }, [session, sessionId, onPreviewReady]);

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
    previewAction,
    wrapUpAdventure,
    endAdventure,
    // Explicit operation lifecycle (idle / submitting / resolving / following_up),
    // independent of connectionState.
    operationPhase: ops.phase,
    actionPreview,
    clearPreview,
    previewThinking,
  };
}
