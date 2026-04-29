import { broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import type { AIInput, SessionState, TurnResult } from '../types.js';
import { AiDmService } from './aiDmService.js';
import { GameEngine } from './gameEngine.js';
import { ImageService } from './imageService.js';
import { StateService } from './stateService.js';
import { StorySummaryService } from './storySummaryService.js';

interface CompletedTurnSideEffectsInput {
  sessionId: string;
  namespaceId: string | undefined;
  previousSession: SessionState;
  newState: SessionState;
  turnResult: TurnResult;
}

export const queueCompletedTurnSideEffects = ({
  sessionId,
  namespaceId,
  previousSession,
  newState,
  turnResult,
}: CompletedTurnSideEffectsInput) => {
  setImmediate(() => void StorySummaryService.maybeUpdate(sessionId, newState.turn, previousSession.useLocalAI));
  queuePartyWipeFollowUp(sessionId, namespaceId, previousSession, newState);
  queueTurnImageGeneration(sessionId, previousSession, newState, turnResult);
};

const queuePartyWipeFollowUp = (
  sessionId: string,
  namespaceId: string | undefined,
  previousSession: SessionState,
  newState: SessionState,
) => {
  if (!GameEngine.isPartyWiped(newState)) {
    return;
  }

  const rescueLimit = GameEngine.getRescueLimit(newState.difficulty);
  const rescuesUsed = newState.interventionState?.rescuesUsed ?? 0;

  if (rescuesUsed >= rescueLimit) {
    void (async () => {
      try {
        console.log('[GameOver] Party wiped with no rescues remaining — campaign over');
        const gameOverState = { ...newState, gameOver: true };
        await StateService.updateSession(sessionId, gameOverState);
        broadcastUpdate(sessionId, 'game_over', { session: gameOverState });
        broadcastSessionChanged(namespaceId, sessionId, 'updated');
        console.log('[GameOver] State saved and broadcast');
      } catch (err) {
        console.error('[GameOver] Failed:', err);
      }
    })();
    return;
  }

  if (rescuesUsed === 0) {
    queueInterventionRescue(sessionId, namespaceId, previousSession, newState);
    return;
  }

  queueSanctuaryRecovery(sessionId, namespaceId, previousSession, newState, rescuesUsed, rescueLimit);
};

const queueInterventionRescue = (
  sessionId: string,
  namespaceId: string | undefined,
  previousSession: SessionState,
  newState: SessionState,
) => {
  void (async () => {
    try {
      console.log('[Intervention] Party wiped — triggering dragon rescue');
      const rescuedState = GameEngine.applyIntervention(newState);
      await StateService.updateSession(sessionId, rescuedState);

      const interventionInput: AIInput = {
        ...rescuedState,
        characterId: '',
        actionAttempt: 'A mysterious force saved the party from doom',
        actionResult: { success: true, roll: 0, statUsed: 'none' },
        interventionRescue: true,
      };
      const interventionTurn = await AiDmService.generateTurnResult(interventionInput, previousSession.useLocalAI);
      interventionTurn.turnType = 'intervention';
      interventionTurn.imageUrl = '/images/intervention_dragon.png';

      const postState = GameEngine.updateState(rescuedState, interventionInput, interventionTurn as unknown as Record<string, unknown>);
      await StateService.updateSession(sessionId, postState);
      interventionTurn.id = await StateService.addTurnResult(sessionId, interventionTurn, null);
      broadcastUpdate(sessionId, 'intervention', { session: postState, turnResult: interventionTurn });
      broadcastSessionChanged(namespaceId, sessionId, 'updated');
      setImmediate(() => void StorySummaryService.updateAfterIntervention(sessionId, interventionTurn.narration, previousSession.useLocalAI));
      console.log('[Intervention] Dragon rescue complete');
    } catch (err) {
      console.error('[Intervention] Failed:', err);
    }
  })();
};

const queueSanctuaryRecovery = (
  sessionId: string,
  namespaceId: string | undefined,
  previousSession: SessionState,
  newState: SessionState,
  rescuesUsed: number,
  rescueLimit: number,
) => {
  void (async () => {
    try {
      console.log(`[Sanctuary] Party wiped (rescue ${rescuesUsed + 1}/${rescueLimit}) — triggering sanctuary recovery`);
      const sanctuaryState = GameEngine.applySanctuaryRecovery(newState);
      await StateService.updateSession(sessionId, sanctuaryState);

      const sanctuaryInput: AIInput = {
        ...sanctuaryState,
        characterId: '',
        actionAttempt: 'The party woke up somewhere safe, battered but alive',
        actionResult: { success: true, roll: 0, statUsed: 'none' },
        sanctuaryRecovery: true,
      };
      const sanctuaryTurn = await AiDmService.generateTurnResult(sanctuaryInput, previousSession.useLocalAI);
      sanctuaryTurn.turnType = 'sanctuary';
      sanctuaryTurn.imageUrl = '/images/sanctuary_light.png';

      const postState = GameEngine.updateState(sanctuaryState, sanctuaryInput, sanctuaryTurn as unknown as Record<string, unknown>);
      await StateService.updateSession(sessionId, postState);
      sanctuaryTurn.id = await StateService.addTurnResult(sessionId, sanctuaryTurn, null);
      broadcastUpdate(sessionId, 'sanctuary_recovery', { session: postState, turnResult: sanctuaryTurn });
      broadcastSessionChanged(namespaceId, sessionId, 'updated');
      setImmediate(() => void StorySummaryService.updateAfterIntervention(sessionId, sanctuaryTurn.narration, previousSession.useLocalAI));
      console.log('[Sanctuary] Recovery complete');
    } catch (err) {
      console.error('[Sanctuary] Failed:', err);
    }
  })();
};

const queueTurnImageGeneration = (
  sessionId: string,
  previousSession: SessionState,
  newState: SessionState,
  turnResult: TurnResult,
) => {
  console.log(`[Action] imageSuggested=${turnResult.imageSuggested} imagePrompt=${turnResult.imagePrompt ?? 'null'} savingsMode=${previousSession.savingsMode}`);
  if (previousSession.savingsMode || !turnResult.imageSuggested || !turnResult.imagePrompt) {
    return;
  }

  void ImageService.generateImage(turnResult.imagePrompt, previousSession.id, newState.turn, previousSession.useLocalAI).then(async result => {
    if (result) {
      await StateService.updateLatestTurnImage(sessionId, result.url, result.storageKey, result.storageProvider);
      broadcastUpdate(sessionId, 'image_ready', { imageUrl: result.url });
    }
  }).catch(err => console.error('[Action] Background image generation failed:', err));
};
