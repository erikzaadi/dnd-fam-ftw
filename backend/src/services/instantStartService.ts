import { createId } from '../lib/ids.js';
import { AiDmService } from './aiDmService.js';
import { ImageService } from './imageService.js';
import { StateService } from './stateService.js';
import { StorySummaryService } from './storySummaryService.js';
import { broadcastInstantStartReady, broadcastUpdate } from '../realtime/sessionEvents.js';
import { refreshDmPrepImageBriefAndPreview, triggerPreviewRegen } from './sessionPreviewService.js';
import { pickRandomPartyArchetypes, pickWorldSeed } from '../data/instantStartArchetypes.js';
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

export async function runInstantStartBackground(
  sessionId: string,
  session: SessionState,
  namespaceId: string,
): Promise<void> {
  const avatarPromises = session.party.map(async char => {
    try {
      const result = await ImageService.generateAvatar(char, sessionId, session.useLocalAI);
      const current = await StateService.getSession(sessionId);
      if (!current) {
        return;
      }
      const idx = current.party.findIndex(c => c.id === char.id);
      if (idx === -1) {
        return;
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
  });

  const realmPromise = async () => {
    const seed = pickWorldSeed();

    const withRealm = await StateService.getSession(sessionId);
    if (!withRealm) {
      return;
    }
    withRealm.worldDescription = seed.worldDescription;
    withRealm.displayName = seed.displayName;
    await StateService.updateSession(sessionId, withRealm);

    const dmPrep = await StorySummaryService.generateCampaignBrief(
      sessionId,
      seed.worldDescription,
      session.useLocalAI,
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

    refreshDmPrepImageBriefAndPreview(sessionId, dmPrep, session.useLocalAI, namespaceId);

    const forTurn = await StateService.getSession(sessionId);
    if (!forTurn) {
      return;
    }

    let initialTurn;
    try {
      initialTurn = await AiDmService.generateTurnResult(
        { ...forTurn, characterId: '', actionAttempt: 'Adventure begins!', actionResult: { success: true, roll: 20, statUsed: 'none' } },
        forTurn.useLocalAI,
      );
    } catch (err) {
      console.error('[InstantStart] First turn generation failed:', err);
      broadcastInstantStartReady(namespaceId, sessionId);
      return;
    }

    initialTurn.id = await StateService.addTurnResult(sessionId, initialTurn, null);
    broadcastUpdate(sessionId, 'turn_complete', { session: forTurn, turnResult: initialTurn });

    if (forTurn.savingsMode) {
      broadcastInstantStartReady(namespaceId, sessionId);
      return;
    }

    try {
      const imageResult = await ImageService.generateImage(
        initialTurn.imagePrompt || 'A fantasy realm establishing scene',
        sessionId,
        forTurn.turn,
        forTurn.useLocalAI,
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
        broadcastUpdate(sessionId, 'image_ready', { imageUrl: imageResult.url });
      }
    } catch (err) {
      console.error('[InstantStart] Scene image generation failed:', err);
    }

    triggerPreviewRegen(sessionId, session.useLocalAI, namespaceId);
  };

  await Promise.allSettled([
    Promise.allSettled(avatarPromises),
    realmPromise(),
  ]);
}
