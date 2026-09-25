import { useCallback, useState } from 'react';
import type { Choice, Session, TurnResult, FreeActionPreview } from '../../types';
import { useSessionRuntime } from '../useSessionRuntime';
import { requestWrapUp } from '../adventureActions';
import { applySessionTension, playRollSfx } from '../sessionAudio';

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

// Car and terminal adapter over the shared session runtime: the same data, lifecycle
// and submission as the Session page, with speech/transcript-shaped callbacks.
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
  const runtime = useSessionRuntime({
    sessionId,
    presenter: {
      onConnected,
      onNarrating: () => onNarrating(),
      onRollRevealed: (rollNarration, actionResult) => {
        if (actionResult) {
          playRollSfx(actionResult);
        }
        if (rollNarration) {
          onPendingRollNarration?.(rollNarration);
        }
      },
      onTurnComplete: (session, turn) => {
        applySessionTension(session, turn);
        if (turn) {
          onTurnComplete(session, turn);
        }
      },
      // Rescue turns and the ending are spoken/printed once like any turn.
      onFollowUpTurn: (kind, _narration, session, turn) => {
        if (kind === 'conclusion') {
          applySessionTension(session, turn);
        }
        if (session && turn) {
          onTurnComplete(session, turn);
        }
      },
      onTurnError,
      onWaitEnded: failed => {
        if (failed) {
          onTurnError(failed.errorCode ?? 'turn_failed', failed.errorMessage ?? 'Something went wrong. Please try again.');
        }
      },
      onImageReady: event => {
        if (event.target === 'scene') {
          onImageReady?.(event.imageUrl);
        }
      },
      onPartyUpdate: session => {
        if (session) {
          applySessionTension(session);
        }
      },
      onPreviewReady,
      onClarification,
      onPreviewNotice,
    },
  });
  const { submitTurn, submitOperation, updateSession, revisionRef } = runtime;

  const send = useCallback(async (input: Parameters<typeof submitTurn>[0]) => {
    const result = await submitTurn(input);
    if (!result.ok) {
      onTurnError(result.error, result.message);
    }
  }, [submitTurn, onTurnError]);

  const submitAction = useCallback((
    action: string,
    statUsed?: string,
    difficulty?: string,
    difficultyValue?: number | null,
    ownerCharId?: string | null,
    itemId?: string | null,
    targetCharId?: string | null,
    actionIntent?: string,
  ) => send({ action, statUsed, difficulty, difficultyValue, characterId: ownerCharId, itemId, targetCharacterId: targetCharId, actionIntent }), [send]);

  // A suggestion is selected explicitly, never by text that happens to equal its label.
  const submitChoice = useCallback((choice: Choice) => (
    send({ action: choice.label, statUsed: choice.stat, difficulty: choice.difficulty, difficultyValue: choice.difficultyValue ?? null, choiceId: choice.id })
  ), [send]);

  // Session-management commands (spoken in car mode, typed in the terminal).
  const wrapUpAdventure = useCallback(async (): Promise<string | null> => {
    const result = await requestWrapUp(sessionId, revisionRef.current);
    if (!result.ok) {
      return result.message;
    }
    updateSession(result.adventure ? { adventure: result.adventure } : {}, result.revision);
    return null;
  }, [sessionId, revisionRef, updateSession]);

  const endAdventure = useCallback(
    () => submitOperation('/adventure/end', {}, { expectsFollowUp: true }),
    [submitOperation],
  );

  // Encounter status before the latest turn landed, so a view can announce boundaries
  // (encounter began / ended) when it speaks or prints that turn.
  const session = runtime.session;
  const encounterStatus = session?.encounterState?.status ?? 'none';
  const latestTurnId = runtime.latestTurn?.id;
  const [encounterTrack, setEncounterTrack] = useState({ turnId: latestTurnId, before: 'none', current: 'none' });
  if (session && (encounterTrack.turnId !== latestTurnId || encounterTrack.current !== encounterStatus)) {
    const newTurn = encounterTrack.turnId !== latestTurnId;
    setEncounterTrack({
      turnId: latestTurnId,
      before: newTurn ? encounterTrack.current : encounterTrack.before,
      current: encounterStatus,
    });
  }

  return {
    session,
    history: runtime.history,
    loading: runtime.busy || runtime.turnPhase === 'initializing',
    actionError: runtime.actionError,
    setActionError: runtime.setActionError,
    connectionState: runtime.connectionState,
    prevEncounterStatus: encounterTrack.before,
    submitAction,
    submitChoice,
    previewAction: runtime.previewAction,
    wrapUpAdventure,
    endAdventure,
    operationPhase: runtime.operationPhase,
    actionPreview: runtime.actionPreview,
    clearPreview: runtime.clearPreview,
    previewThinking: runtime.previewThinking,
    clarification: runtime.clarification,
    clearClarification: runtime.clearClarification,
    ideas: runtime.ideas,
    requestIdeas: runtime.requestIdeas,
  };
}
