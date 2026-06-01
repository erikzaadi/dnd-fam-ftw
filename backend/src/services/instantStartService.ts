import { createId } from '../lib/ids.js';
import { AiDmService } from './aiDmService.js';
import { ImageService } from './imageService.js';
import { StateService } from './stateService.js';
import { StorySummaryService } from './storySummaryService.js';
import { broadcastInstantStartReady, broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import { refreshDmPrepImageBriefAndPreview } from './sessionPreviewService.js';
import { pickRandomPartyArchetypes, type WorldSeed } from '../data/instantStartArchetypes.js';
import type { Character, SessionState } from '../types.js';

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
      const current = await StateService.getSession(sessionId);
      if (!current) {
        return;
      }
      const idx = current.party.findIndex(c => c.id === char.id);
      if (idx === -1) {
        continue;
      }
      current.party[idx] = {
        ...current.party[idx],
        avatarUrl: result.url,
        avatarPrompt: result.prompt,
        avatarStorageKey: result.storageKey,
        avatarStorageProvider: result.storageProvider,
      };
      await StateService.updateSession(sessionId, current);
      broadcastUpdate(sessionId, 'party_update', { session: current });
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
): Promise<void> {
  // --- Text critical path: realm description -> campaign brief -> first turn ---
  const withRealm = await StateService.getSession(sessionId);
  if (!withRealm) {
    return;
  }
  withRealm.worldDescription = seed.worldDescription;
  withRealm.displayName = seed.displayName;
  await StateService.updateSession(sessionId, withRealm);
  broadcastSessionChanged(namespaceId, sessionId, 'updated');

  const dmPrep = await StorySummaryService.generateCampaignBrief(
    sessionId,
    seed.worldDescription,
    seed.displayName,
    'normal',
    session.gameMode,
  ).catch(err => {
    console.warn('[InstantStart] Campaign brief generation failed:', err);
    return null;
  });

  if (dmPrep) {
    const withPrep = await StateService.getSession(sessionId);
    if (withPrep) {
      withPrep.dmPrep = dmPrep;
      await StateService.updateSession(sessionId, withPrep);
    }
  }

  // Start preview image in background now that we have dm prep context
  refreshDmPrepImageBriefAndPreview(sessionId, dmPrep, namespaceId);

  const forTurn = await StateService.getSession(sessionId);
  if (!forTurn) {
    return;
  }

  let initialTurn;
  try {
    initialTurn = await AiDmService.generateTurnResult(
      { ...forTurn, characterId: '', actionAttempt: 'Adventure begins!', actionResult: { success: true, roll: 20, statUsed: 'none' } },
    );
  } catch (err) {
    console.error('[InstantStart] First turn generation failed:', err);
    broadcastInstantStartReady(namespaceId, sessionId);
    return;
  }

  initialTurn.id = await StateService.addTurnResult(sessionId, initialTurn, null);
  forTurn.turn = Math.max(forTurn.turn, 2);
  forTurn.lastChoices = initialTurn.choices;
  await StateService.updateSession(sessionId, forTurn);
  broadcastUpdate(sessionId, 'turn_complete', { session: forTurn, turnResult: initialTurn });

  // Session is playable - signal navigation before starting slow image generation
  broadcastInstantStartReady(namespaceId, sessionId);

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
      if (imageResult) {
        await StateService.updateLatestTurnImage(sessionId, imageResult.url, imageResult.storageKey, imageResult.storageProvider);
        broadcastUpdate(sessionId, 'image_ready', { target: 'scene', imageUrl: imageResult.url, turnId: initialTurn.id ?? 0 });
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
