import { createId } from '../lib/ids.js';
import { ImageService } from './imageService.js';
import { StateService } from './stateService.js';
import { StorySummaryService } from './storySummaryService.js';
import { broadcastInstantStartReady, broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import { refreshDmPrepImageBriefAndPreview } from './sessionPreviewService.js';
import { pickRandomPartyArchetypes, type WorldSeed } from '../data/instantStartArchetypes.js';
import type { Character, SessionState } from '../types.js';
import type { StoredOperation } from '../repositories/operationRepository.js';
import { runSessionOperation } from './sessionOperationService.js';
import { generateAndCommitInitialTurn } from './initialTurnService.js';
import { attachTurnImage } from './turnSideEffectService.js';
import { RealmOriginStoryService } from './realmOriginStoryService.js';

export function buildInstantStartParty(sessionId: string): Character[] {
  const archetypes = pickRandomPartyArchetypes();
  return archetypes.map(archetype => ({
    id: createId(),
    name: archetype.name,
    class: archetype.class,
    species: archetype.species,
    quirk: archetype.quirk,
    hp: archetype.maxHp,
    max_hp: archetype.maxHp,
    status: 'active' as const,
    stats: archetype.stats,
    inventory: [],
    avatarUrl: ImageService.generateInitialsSvg(archetype.name, sessionId),
    avatarPrompt: '',
    avatarStorageKey: '',
    avatarStorageProvider: 'local',
  }));
}

async function generateAvatars(party: Character[], sessionId: string): Promise<void> {
  // Sequential (not parallel) to avoid API quota spikes that compete with narration on early turns
  for (const char of party) {
    try {
      const result = await ImageService.generateAvatar(char, sessionId);
      // Narrow per-character write: never rewrite the whole session from a stale copy,
      // which could undo gameplay committed while the avatar was generating.
      StateService.updateCharacterAvatar(char.id, result.url, result.prompt, result.storageKey, result.storageProvider);
      broadcastUpdate(sessionId, 'image_ready', { target: 'character_avatar', characterId: char.id, imageUrl: result.url });
    } catch (err) {
      console.warn(`[InstantStart] Avatar generation failed for ${char.name}:`, err);
    }
  }
}

export async function runInstantStartBackground(
  sessionId: string,
  session: SessionState,
  namespaceId: string,
  seed: WorldSeed,
  operation: StoredOperation | null,
): Promise<void> {
  // The realm name and description were stored at creation; the campaign brief
  // stores its own DM Prep via narrow patches.
  broadcastSessionChanged(namespaceId, sessionId, 'updated');

  // The origin story is shown before the opening scene (website origin view, MCP
  // opening), so start it now instead of when the first viewer asks. One short text
  // call; failures store a fallback.
  void RealmOriginStoryService.generate(sessionId).catch(err => {
    console.warn('[InstantStart] Origin story generation failed:', err);
  });

  // Heavy media work (encounter avatars, area images, image briefs, preview)
  // competes with the first-turn narration call for API throughput and has
  // caused turn-1 narration timeouts. Gate all of it until turn 1 is stored.
  let releaseMediaGate = (): void => {};
  const mediaGate = new Promise<void>(resolve => {
    releaseMediaGate = resolve;
  });

  const dmPrep = await StorySummaryService.generateCampaignBrief(
    sessionId,
    seed.worldDescription,
    seed.displayName,
    'normal',
    session.gameMode,
    { mediaGate, adventureFormat: session.adventure?.format ?? 'one_evening' },
  ).catch(err => {
    console.warn('[InstantStart] Campaign brief generation failed:', err);
    return null;
  });

  const started: { result?: NonNullable<Awaited<ReturnType<typeof generateAndCommitInitialTurn>>> } = {};
  const work = async () => {
    const result = await generateAndCommitInitialTurn({ sessionId, operationId: operation?.id });
    if (!result) {
      return { error: 'not_found', message: 'Session not found' };
    }
    started.result = result;
  };
  if (operation) {
    await runSessionOperation(operation, work);
  } else {
    await work().catch(err => {
      console.error('[InstantStart] First turn generation failed:', err);
    });
  }

  // Session is playable (or failed visibly) - signal navigation before slow image work.
  broadcastInstantStartReady(namespaceId, sessionId);
  refreshDmPrepImageBriefAndPreview(sessionId, dmPrep, namespaceId);
  releaseMediaGate();

  const initial = started.result;
  if (!initial) {
    console.error(`[InstantStart] First turn was not committed for session ${sessionId}`);
    return;
  }
  const { turn: initialTurn, state: forTurn } = initial;
  if (forTurn.savingsMode) {
    return;
  }

  // --- Image generation: all start concurrently after user can play ---
  const sceneImageTask = async () => {
    try {
      const imageResult = await ImageService.generateImage(
        initialTurn.imagePrompt || 'A fantasy realm establishing scene',
        sessionId,
        forTurn.turn,
        undefined,
        undefined,
        {
          worldDescription: forTurn.worldDescription,
          dmPrepImageBrief: forTurn.dmPrepImageBrief,
          party: forTurn.party,
          activeCharacterId: forTurn.activeCharacterId,
          currentTensionLevel: initialTurn.currentTensionLevel,
        },
      );
      if (imageResult && initialTurn.id) {
        await attachTurnImage(sessionId, initialTurn.id, imageResult);
      }
    } catch (err) {
      console.error('[InstantStart] Scene image generation failed:', err);
    }
  };

  await Promise.allSettled([
    generateAvatars(session.party, sessionId),
    sceneImageTask(),
  ]);
}
