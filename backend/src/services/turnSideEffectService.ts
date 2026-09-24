import { broadcastUpdate } from '../realtime/sessionEvents.js';
import type { SessionState, TurnResult } from '../types.js';
import { runBackground } from '../middleware/runBackground.js';
import { ImageService } from './imageService.js';
import { getImageStorageProvider } from '../providers/storage/storageProviderFactory.js';
import { StateService } from './stateService.js';
import { StorySummaryService } from './storySummaryService.js';
import { devLog } from '../lib/devLog.js';
import { generateImageBrief } from '../providers/ai/images/imageBriefProvider.js';

interface CompletedTurnSideEffectsInput {
  sessionId: string;
  namespaceId: string | undefined;
  previousSession: SessionState;
  newState: SessionState;
  turnResult: TurnResult;
}

const inFlightImageJobs = new Set<string>();

type GeneratedImage = { url: string; storageKey: string; storageProvider: string };

// Binds a late image to one exact turn. If the turn (or its session) was deleted while
// the image was generating, the stored file is removed instead of being orphaned.
export const attachTurnImage = async (sessionId: string, turnId: number, image: GeneratedImage): Promise<void> => {
  const attached = await StateService.updateTurnImage(sessionId, turnId, image.url, image.storageKey, image.storageProvider);
  if (attached) {
    broadcastUpdate(sessionId, 'image_ready', { target: 'scene', imageUrl: image.url, turnId });
    return;
  }
  devLog.log(`[Images] Discarding image for missing turn=${turnId} session=${sessionId}`);
  if (image.storageKey) {
    await getImageStorageProvider().deleteImage(image.storageKey).catch(err => {
      console.warn(`[Images] Failed to delete discarded image key=${image.storageKey}:`, err);
    });
  }
};

export const queueCompletedTurnSideEffects = ({
  sessionId,
  previousSession,
  newState,
  turnResult,
}: CompletedTurnSideEffectsInput) => {
  // Party wipe follow-ups (rescue, sanctuary, game over) are gameplay, not enrichment:
  // they run inside the turn's operation (see partyRecoveryService).
  runBackground(`story-summary session=${sessionId} turn=${newState.turn}`, () => StorySummaryService.maybeUpdate(sessionId, newState.turn));
  queueTurnImageGeneration(sessionId, previousSession, newState, turnResult);
  queueEncounterImageGeneration(sessionId, previousSession, newState);
};

const queueTurnImageGeneration = (
  sessionId: string,
  previousSession: SessionState,
  newState: SessionState,
  turnResult: TurnResult,
) => {
  devLog.log(`[Action] savingsMode=${previousSession.savingsMode}`);
  if (previousSession.savingsMode) {
    return;
  }

  const sceneKey = `scene:${sessionId}:${newState.turn}`;
  if (inFlightImageJobs.has(sceneKey)) {
    return;
  }
  inFlightImageJobs.add(sceneKey);

  const activeCharacter = newState.party.find(c => c.id === newState.activeCharacterId);

  void generateImageBrief(
    turnResult.narration,
    newState.worldDescription ?? newState.id,
    activeCharacter?.name,
    turnResult.currentTensionLevel,
  ).then(brief => {
    if (!brief) {
      return null;
    }
    return ImageService.generateImage(
      brief,
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
    );
  }).then(async result => {
    if (result && turnResult.id) {
      await attachTurnImage(sessionId, turnResult.id, result);
    }
  }).catch(err => {
    console.error('[Action] Background image generation failed:', err);
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
      console.error(`[EncounterImages] Avatar generation failed for enemy "${enemy.name}":`, err);
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
      console.error(`[EncounterImages] Area image generation failed for area "${area.label}":`, err);
    })
      .finally(() => {
        inFlightImageJobs.delete(areaKey);
      });
  }
};
