import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session, TurnResult, FreeActionPreview, ImageReadyEvent } from '../../types';
import { apiFetch } from '../../lib/api';
import { useSessionEvents } from '../../hooks/useSessionEvents';
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

  const loadSession = useCallback(async () => {
    try {
      const res = await apiFetch(`/session/${sessionId}`);
      if (!res.ok) {
        navigate('/');
        return;
      }
      const data = await res.json();
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
  }, [sessionId, navigate]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const refetchHistory = useCallback(async () => {
    try {
      const hRes = await apiFetch(`/session/${sessionId}/history`);
      if (hRes.ok) {
        const hData = await hRes.json();
        setHistory(hData);
      }
    } catch (err) {
      console.error('[CarRuntime] Error refetching history:', err);
    }
  }, [sessionId]);

  const { connectionState } = useSessionEvents({
    sessionId,
    onConnected: () => {
      onConnected();
      if (historyRef.current.length === 0) {
        void refetchHistory();
      }
    },
    onGameOver: (updatedSession) => {
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
    onTurnComplete: (updatedSession, turnResult) => {
      setSession(updatedSession);
      if (turnResult) {
        setHistory(prev => [...prev, turnResult]);
        setLoading(false);
        onTurnComplete(updatedSession, turnResult);
      } else {
        void refetchHistory();
      }
    },
    onTurnError: (error, message) => {
      setActionError(message);
      setLoading(false);
      onTurnError(error, message);
    },
    onImageReady: (event: ImageReadyEvent) => {
      if (event.target === 'scene') {
        onImageReady?.(event.imageUrl);
      }
    },
    onIntervention: () => {},
    onSanctuaryRecovery: () => {},
    onPartyUpdate: (updatedSession) => {
      if (updatedSession) {
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

    try {
      const res = await apiFetch(`/session/${sessionId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          statUsed,
          difficulty,
          difficultyValue,
          characterId: ownerCharId ?? undefined,
          actionType,
          itemId: itemId ?? undefined,
          targetCharacterId: targetCharId ?? undefined,
          ...(actionIntent && { actionIntent }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Action failed');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
      setActionError(msg);
      setLoading(false);
      onTurnError('turn_failed', msg);
    }
  }, [session, sessionId, onTurnError]);

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
      setActionPreview(preview);
      setPreviewThinking(false);
      onPreviewReady?.(preview);
    }
  }, [session, sessionId, onPreviewReady]);

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
    actionPreview,
    clearPreview,
    previewThinking,
  };
}
