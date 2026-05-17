import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { createId } from '../lib/ids.js';
import { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';
import { broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import { ImageService } from '../services/imageService.js';
import { StateService } from '../services/stateService.js';
import { getStartingMaxHp } from '../services/characterHpService.js';
import { triggerPreviewRegen } from '../services/sessionPreviewService.js';
import type { Character } from '../types.js';
import { parseBody } from './routeValidation.js';
import { registerSessionIdParam } from '../middleware/sessionParam.js';
import { runBackground } from '../middleware/runBackground.js';

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
    const characters = await StateService.listAllCharacters(req.namespaceId);
    const sessions = await StateService.listSessions(req.namespaceId);
    const sessionMap = new Map(sessions.map(s => [s.id, s.displayName]));

    const enhancedCharacters = await Promise.all(characters.map(async (char) => {
      const sessionId = await StateService.getSessionIdForCharacter(char.id);
      return { ...char, sessionName: sessionId ? sessionMap.get(sessionId) : 'Unknown' };
    }));
    res.json(enhancedCharacters);
  }));

  router.post('/character/create', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, characterBodySchema);
    if (!body) {
      return;
    }
    const { sessionId, characterData } = body;
    const sessionNamespace = StateService.getSessionNamespaceId(sessionId);
    if (!sessionNamespace || sessionNamespace !== req.namespaceId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const session = await StateService.getSession(sessionId);
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
    await StateService.updateSession(sessionId, session);
    broadcastUpdate(sessionId, 'party_update', { session });
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
    const sessionNamespace = StateService.getSessionNamespaceId(sessionId);
    if (!sessionNamespace || sessionNamespace !== req.namespaceId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const session = await StateService.getSession(sessionId);
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
    await StateService.updateSession(sessionId, session);
    broadcastUpdate(sessionId, 'party_update', { session });
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
    const turns = StateService.getCharacterTurnHistory(charId);
    if (turns.length === 0) {
      res.json({ summary: null });
      return;
    }
    const session = await StateService.listSessions(req.namespaceId);
    const sessionWithChar = session.find(s => s.party.some(p => p.id === charId));
    const narrationContext = turns.slice(-10).map(t => t.narration).join(' ');
    const { client, model } = createChatClientForTier('narration');
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: `Summarize in one sentence how this adventurer performed in their past adventure${sessionWithChar ? ` in "${sessionWithChar.displayName}"` : ''}: ${narrationContext}. Focus on their notable actions. Reply with just the sentence, no preamble.` }],
        max_tokens: 80,
      }, { signal: AbortSignal.timeout(15_000) });
      const summary = (response.choices[0].message.content ?? '').trim();
      res.json({ summary });
    } catch {
      res.json({ summary: null });
    }
  }));

  router.delete('/session/:sessionId/character/:charId', asyncHandler(async (req, res) => {
    const { sessionId, charId } = req.params;
    const session = req.session!;

    StateService.deleteCharacter(charId as string);
    broadcastUpdate(sessionId as string, 'party_update', { session });
    broadcastSessionChanged(req.namespaceId, sessionId as string, 'updated');
    triggerPreviewRegen(sessionId as string, req.namespaceId);
    res.json({ success: true });
  }));

  return router;
};
