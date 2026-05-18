import { broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import type { AIInput, SessionState, TurnResult } from '../types.js';
import { runBackground } from '../middleware/runBackground.js';
import { AiDmService } from './aiDmService.js';
import { GameEngine } from './gameEngine.js';
import { ImageService } from './imageService.js';
import { StateService } from './stateService.js';
import { StorySummaryService } from './storySummaryService.js';
import { devLog } from '../lib/devLog.js';

interface CompletedTurnSideEffectsInput {
  sessionId: string;
  namespaceId: string | undefined;
  previousSession: SessionState;
  newState: SessionState;
  turnResult: TurnResult;
}

const inFlightImageJobs = new Set<string>();

const getTurnEncounterId = (previousSession: SessionState, newState: SessionState): string | undefined => {
  if (previousSession.encounterState?.status === 'active') {
    return previousSession.encounterState.id;
  }
  if (newState.encounterState?.status === 'active' && previousSession.encounterState?.id !== newState.encounterState.id) {
    return newState.encounterState.id;
  }
  return undefined;
};

export const queueCompletedTurnSideEffects = ({
  sessionId,
  namespaceId,
  previousSession,
  newState,
  turnResult,
}: CompletedTurnSideEffectsInput) => {
  runBackground(`story-summary session=${sessionId} turn=${newState.turn}`, () => StorySummaryService.maybeUpdate(sessionId, newState.turn));
  queuePartyWipeFollowUp(sessionId, namespaceId, previousSession, newState);
  queueTurnImageGeneration(sessionId, previousSession, newState, turnResult);
  queueEncounterImageGeneration(sessionId, previousSession, newState);
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
    runBackground(`game-over session=${sessionId}`, async () => {
      devLog.log('[GameOver] Party wiped with no rescues remaining — campaign over');
      const gameOverState = { ...newState, gameOver: true };
      await StateService.updateSession(sessionId, gameOverState);
      broadcastUpdate(sessionId, 'game_over', { session: gameOverState });
      broadcastSessionChanged(namespaceId, sessionId, 'updated');
      devLog.log('[GameOver] State saved and broadcast');
    });
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
  runBackground(`intervention session=${sessionId}`, async () => {
    devLog.log('[Intervention] Party wiped — triggering dragon rescue');
    const rescuedState = GameEngine.applyIntervention(newState);
    await StateService.updateSession(sessionId, rescuedState);

    const interventionInput: AIInput = {
      ...rescuedState,
      characterId: '',
      actionAttempt: 'A mysterious force saved the party from doom',
      actionResult: { success: true, roll: 0, statUsed: 'none' },
      interventionRescue: true,
    };
    const interventionTurn = await AiDmService.generateTurnResult(interventionInput);
    interventionTurn.turnType = 'intervention';
    interventionTurn.imageUrl = '/images/intervention_dragon.png';

    const postState = GameEngine.updateState(rescuedState, interventionInput, interventionTurn as unknown as Record<string, unknown>);
    await StateService.updateSession(sessionId, postState);
    interventionTurn.encounterId = getTurnEncounterId(rescuedState, postState);
    interventionTurn.id = await StateService.addTurnResult(sessionId, interventionTurn, null);
    broadcastUpdate(sessionId, 'intervention', { session: postState, turnResult: interventionTurn });
    broadcastSessionChanged(namespaceId, sessionId, 'updated');
    runBackground(`intervention-summary session=${sessionId}`, () => StorySummaryService.updateAfterIntervention(sessionId, interventionTurn.narration));
    devLog.log('[Intervention] Dragon rescue complete');
  });
};

const queueSanctuaryRecovery = (
  sessionId: string,
  namespaceId: string | undefined,
  previousSession: SessionState,
  newState: SessionState,
  rescuesUsed: number,
  rescueLimit: number,
) => {
  runBackground(`sanctuary session=${sessionId}`, async () => {
    devLog.log(`[Sanctuary] Party wiped (rescue ${rescuesUsed + 1}/${rescueLimit}) — triggering sanctuary recovery`);
    const sanctuaryState = GameEngine.applySanctuaryRecovery(newState);
    await StateService.updateSession(sessionId, sanctuaryState);

    const sanctuaryInput: AIInput = {
      ...sanctuaryState,
      characterId: '',
      actionAttempt: 'The party woke up somewhere safe, battered but alive',
      actionResult: { success: true, roll: 0, statUsed: 'none' },
      sanctuaryRecovery: true,
    };
    const sanctuaryTurn = await AiDmService.generateTurnResult(sanctuaryInput);
    sanctuaryTurn.turnType = 'sanctuary';
    sanctuaryTurn.imageUrl = '/images/sanctuary_light.png';

    const postState = GameEngine.updateState(sanctuaryState, sanctuaryInput, sanctuaryTurn as unknown as Record<string, unknown>);
    await StateService.updateSession(sessionId, postState);
    sanctuaryTurn.encounterId = getTurnEncounterId(sanctuaryState, postState);
    sanctuaryTurn.id = await StateService.addTurnResult(sessionId, sanctuaryTurn, null);
    broadcastUpdate(sessionId, 'sanctuary_recovery', { session: postState, turnResult: sanctuaryTurn });
    broadcastSessionChanged(namespaceId, sessionId, 'updated');
    runBackground(`sanctuary-summary session=${sessionId}`, () => StorySummaryService.updateAfterIntervention(sessionId, sanctuaryTurn.narration));
    devLog.log('[Sanctuary] Recovery complete');
  });
};

const queueTurnImageGeneration = (
  sessionId: string,
  previousSession: SessionState,
  newState: SessionState,
  turnResult: TurnResult,
) => {
  devLog.log(`[Action] imageSuggested=${turnResult.imageSuggested} imagePrompt=${turnResult.imagePrompt ?? 'null'} savingsMode=${previousSession.savingsMode}`);
  if (previousSession.savingsMode || !turnResult.imageSuggested || !turnResult.imagePrompt) {
    return;
  }

  const sceneKey = `scene:${sessionId}:${newState.turn}`;
  if (inFlightImageJobs.has(sceneKey)) {
    return;
  }
  inFlightImageJobs.add(sceneKey);

  void ImageService.generateImage(
    turnResult.imagePrompt,
    previousSession.id,
    newState.turn,
    undefined,
    undefined,
    {
      worldDescription: newState.worldDescription,
      dmPrepImageBrief: newState.dmPrepImageBrief,
      party: newState.party,
      activeCharacterId: newState.activeCharacterId,
      currentTensionLevel: turnResult.currentTensionLevel,
    },
  ).then(async result => {
    if (result) {
      await StateService.updateLatestTurnImage(sessionId, result.url, result.storageKey, result.storageProvider);
      broadcastUpdate(sessionId, 'image_ready', { target: 'scene', imageUrl: result.url });
    }
  }).catch(err => {
    devLog.error('[Action] Background image generation failed:', err);
  })
    .finally(() => {
      inFlightImageJobs.delete(sceneKey);
    });
};

const queueEncounterImageGeneration = (
  sessionId: string,
  previousSession: SessionState,
  newState: SessionState,
) => {
  const isNewEncounter =
    newState.encounterState?.status === 'active' &&
    newState.encounterState.id !== previousSession.encounterState?.id;

  if (!isNewEncounter || previousSession.savingsMode) {
    return;
  }

  const encounter = newState.encounterState!;

  for (const enemy of encounter.enemies) {
    if (enemy.avatarUrl) {
      continue;
    }
    const enemyKey = `encounter-enemy:${sessionId}:${encounter.id}:${enemy.id}`;
    if (inFlightImageJobs.has(enemyKey)) {
      continue;
    }
    inFlightImageJobs.add(enemyKey);
    void ImageService.generateEnemyAvatar(
      { name: enemy.name, role: enemy.role, traits: enemy.traits },
      sessionId,
    ).then(async result => {
      if (!result.url) {
        devLog.warn(`[EncounterImages] Avatar generation returned empty URL for enemy "${enemy.name}"`);
        return;
      }
      await StateService.patchEncounterEnemyAvatar(sessionId, encounter.id, enemy.id, result.url);
      broadcastUpdate(sessionId, 'image_ready', { target: 'encounter_enemy', encounterId: encounter.id, enemyId: enemy.id, imageUrl: result.url });
    }).catch(err => {
      devLog.error(`[EncounterImages] Avatar generation failed for enemy "${enemy.name}":`, err);
    })
      .finally(() => {
        inFlightImageJobs.delete(enemyKey);
      });
  }

  for (const area of encounter.areas) {
    if (area.imageUrl) {
      continue;
    }
    const areaKey = `encounter-area:${sessionId}:${encounter.id}:${area.id}`;
    if (inFlightImageJobs.has(areaKey)) {
      continue;
    }
    inFlightImageJobs.add(areaKey);
    void ImageService.generateAreaImage(
      { label: area.label, description: area.description, tags: area.tags },
      sessionId,
    ).then(async result => {
      if (!result.url) {
        devLog.warn(`[EncounterImages] Area image generation returned empty URL for area "${area.label}"`);
        return;
      }
      await StateService.patchEncounterAreaImage(sessionId, encounter.id, area.id, result.url);
      broadcastUpdate(sessionId, 'image_ready', { target: 'encounter_area', encounterId: encounter.id, areaId: area.id, imageUrl: result.url });
    }).catch(err => {
      devLog.error(`[EncounterImages] Area image generation failed for area "${area.label}":`, err);
    })
      .finally(() => {
        inFlightImageJobs.delete(areaKey);
      });
  }
};
