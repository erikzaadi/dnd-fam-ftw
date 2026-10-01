import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { createId } from '../lib/ids.js';
import { summarizeHeroHistory } from '../services/playerSummaryService.js';
import { broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import { ImageService } from '../services/imageService.js';
import { StateService } from '../services/stateService.js';
import { characterRepository } from '../repositories/characterRepository.js';
import { turnHistoryRepository } from '../repositories/turnHistoryRepository.js';
import { getStartingMaxHp } from '../services/characterHpService.js';
import { triggerPreviewRegen } from '../services/sessionPreviewService.js';
import type { Character } from '../types.js';
import { parseBody } from './routeValidation.js';
import { registerSessionIdParam } from '../middleware/sessionParam.js';
import { runBackground } from '../middleware/runBackground.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { applyGuardedSessionMutation } from '../services/sessionMutationService.js';
import { requirePaidWork } from '../middleware/usageAdmission.js';

const characterDataSchema = z.object({
  name: z.string().min(1),
  class: z.string().min(1),
  species: z.string().min(1),
  quirk: z.string(),
  stats: z.object({
    might: z.number().int().min(1).max(5),
    magic: z.number().int().min(1).max(5),
    mischief: z.number().int().min(1).max(5),
  }),
  gender: z.string().optional(),
  history: z.string().optional(),
}).passthrough();

const characterBodySchema = z.object({
  sessionId: z.string().min(1),
  characterData: characterDataSchema,
});

export const createCharacterRouter = () => {
  const router = Router();
  registerSessionIdParam(router, 'sessionId');

  router.get('/characters/all', asyncHandler(async (req, res) => {
    const characters = await characterRepository.listAllCharacters(req.namespaceId);
    const sessions = await sessionRepository.listSessions(req.namespaceId);
    const sessionMap = new Map(sessions.map(s => [s.id, s.displayName]));

    const enhancedCharacters = await Promise.all(characters.map(async (char) => {
      const sessionId = await characterRepository.getSessionIdForCharacter(char.id);
      return { ...char, sessionName: sessionId ? sessionMap.get(sessionId) : 'Unknown' };
    }));
    res.json(enhancedCharacters);
  }));

  router.post('/character/create', requirePaidWork('website'), asyncHandler(async (req, res) => {
    const body = parseBody(req, res, characterBodySchema);
    if (!body) {
      return;
    }
    const { sessionId, characterData } = body;
    const sessionNamespace = sessionRepository.getSessionNamespaceId(sessionId);
    if (!sessionNamespace || sessionNamespace !== req.namespaceId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const session = await sessionRepository.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const startingMaxHp = getStartingMaxHp(characterData.class);
    const charId = createId();

    const initialsUrl = session.savingsMode
      ? ImageService.generateInitialsSvg(characterData.name, sessionId)
      : undefined;

    const character: Character = {
      id: charId,
      hp: startingMaxHp,
      max_hp: startingMaxHp,
      status: 'active',
      inventory: [],
      avatarUrl: initialsUrl,
      ...characterData,
    };

    session.party.push(character);
    if (!session.activeCharacterId) {
      session.activeCharacterId = character.id;
    }
    const mutation = applyGuardedSessionMutation(sessionId, undefined, () => {
      sessionRepository.updateSessionSync(sessionId, session);
    });
    if (!mutation.ok) {
      res.status(mutation.status).json(mutation.body);
      return;
    }
    session.revision = mutation.revision;
    broadcastUpdate(sessionId, 'party_update', { session, revision: mutation.revision });
    broadcastSessionChanged(req.namespaceId, sessionId, 'updated');
    res.json(character);

    if (!session.savingsMode) {
      const capturedNamespaceId = req.namespaceId;
      runBackground(`avatar-create char=${charId} session=${sessionId}`, async () => {
        const result = await ImageService.generateAvatar(characterData, sessionId);
        StateService.updateCharacterAvatar(charId, result.url, result.prompt, result.storageKey, result.storageProvider);
        broadcastUpdate(sessionId, 'image_ready', { target: 'character_avatar', characterId: charId, imageUrl: result.url });
        triggerPreviewRegen(sessionId, capturedNamespaceId);
        broadcastSessionChanged(capturedNamespaceId, sessionId, 'updated');
      });
    }
  }));

  router.put('/character/:charId', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, characterBodySchema);
    if (!body) {
      return;
    }
    const { sessionId, characterData } = body;
    const charId = req.params.charId as string;
    const sessionNamespace = sessionRepository.getSessionNamespaceId(sessionId);
    if (!sessionNamespace || sessionNamespace !== req.namespaceId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const session = await sessionRepository.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const charIndex = session.party.findIndex(c => c.id === charId);
    if (charIndex === -1) {
      res.status(404).json({ error: 'Character not found' });
      return;
    }

    const updatedChar: Character = {
      ...session.party[charIndex],
      ...characterData,
      // keep existing avatar during transition; new one arrives via image_ready SSE
    };

    if (session.savingsMode) {
      updatedChar.avatarUrl = ImageService.generateInitialsSvg(characterData.name, sessionId);
    }

    session.party[charIndex] = updatedChar;
    const mutation = applyGuardedSessionMutation(sessionId, undefined, () => {
      sessionRepository.updateSessionSync(sessionId, session);
    });
    if (!mutation.ok) {
      res.status(mutation.status).json(mutation.body);
      return;
    }
    session.revision = mutation.revision;
    broadcastUpdate(sessionId, 'party_update', { session, revision: mutation.revision });
    broadcastSessionChanged(req.namespaceId, sessionId, 'updated');
    res.json(updatedChar);

    if (!session.savingsMode) {
      const capturedCharId = charId;
      const capturedNamespaceId = req.namespaceId;
      runBackground(`avatar-update char=${capturedCharId} session=${sessionId}`, async () => {
        const result = await ImageService.generateAvatar(characterData, sessionId);
        StateService.updateCharacterAvatar(capturedCharId, result.url, result.prompt, result.storageKey, result.storageProvider);
        broadcastUpdate(sessionId, 'image_ready', { target: 'character_avatar', characterId: capturedCharId, imageUrl: result.url });
        triggerPreviewRegen(sessionId, capturedNamespaceId);
        broadcastSessionChanged(capturedNamespaceId, sessionId, 'updated');
      });
    }
  }));

  router.get('/character/:charId/history-summary', asyncHandler(async (req, res) => {
    const charId = req.params.charId as string;
    const turns = turnHistoryRepository.getCharacterTurnHistory(charId);
    if (turns.length === 0) {
      res.json({ summary: null });
      return;
    }
    const session = await sessionRepository.listSessions(req.namespaceId);
    const sessionWithChar = session.find(s => s.party.some(p => p.id === charId));
    res.json({ summary: await summarizeHeroHistory(turns, sessionWithChar?.displayName) });
  }));

  router.delete('/session/:sessionId/character/:charId', asyncHandler(async (req, res) => {
    const { sessionId, charId } = req.params;
    const session = req.session!;

    if (!session.party.some(c => c.id === charId)) {
      res.status(404).json({ error: 'Character not found' });
      return;
    }
    const mutation = applyGuardedSessionMutation(sessionId as string, undefined, () => {
      StateService.deleteCharacter(charId as string);
    });
    if (!mutation.ok) {
      res.status(mutation.status).json(mutation.body);
      return;
    }
    const updated = await sessionRepository.getSession(sessionId as string);
    broadcastUpdate(sessionId as string, 'party_update', { session: updated ?? session, revision: mutation.revision });
    broadcastSessionChanged(req.namespaceId, sessionId as string, 'updated');
    triggerPreviewRegen(sessionId as string, req.namespaceId);
    res.json({ success: true });
  }));

  return router;
};
