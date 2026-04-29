import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { createId } from '../lib/ids.js';
import { createChatClient } from '../providers/ai/AiProviderFactory.js';
import { broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import { ImageService } from '../services/imageService.js';
import { StateService } from '../services/stateService.js';
import { triggerPreviewRegen } from '../services/sessionPreviewService.js';
import type { Character } from '../types.js';
import { parseBody } from './routeValidation.js';

const characterDataSchema = z.object({
  name: z.string().min(1),
  class: z.string().min(1),
  species: z.string().min(1),
  quirk: z.string(),
  stats: z.object({
    might: z.number(),
    magic: z.number(),
    mischief: z.number(),
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

  router.get('/characters/all', asyncHandler(async (_req, res) => {
    const characters = await StateService.listAllCharacters();
    const sessions = await StateService.listSessions();
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
    const session = await StateService.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const avatarResult = !session.savingsMode
      ? await ImageService.generateAvatar(characterData, sessionId, session.useLocalAI)
      : { url: ImageService.generateInitialsSvg(characterData.name, sessionId), prompt: '', storageKey: '', storageProvider: 'local' };

    const character: Character = {
      id: createId(),
      hp: 10,
      max_hp: 10,
      status: 'active',
      inventory: [],
      avatarUrl: avatarResult.url,
      avatarPrompt: avatarResult.prompt,
      avatarStorageKey: avatarResult.storageKey,
      avatarStorageProvider: avatarResult.storageProvider,
      ...characterData
    };

    session.party.push(character);
    if (!session.activeCharacterId) {
      session.activeCharacterId = character.id;
    }
    await StateService.updateSession(sessionId, session);
    broadcastUpdate(sessionId, 'party_update', { session });
    broadcastSessionChanged(req.namespaceId, sessionId, 'updated');
    triggerPreviewRegen(sessionId, session.useLocalAI, req.namespaceId);
    res.json(character);
  }));

  router.put('/character/:charId', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, characterBodySchema);
    if (!body) {
      return;
    }
    const { sessionId, characterData } = body;
    const charId = req.params.charId;
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

    const avatarResult = !session.savingsMode
      ? await ImageService.generateAvatar(characterData, sessionId, session.useLocalAI)
      : { url: ImageService.generateInitialsSvg(characterData.name, sessionId), prompt: '', storageKey: '', storageProvider: 'local' };

    const updatedChar = {
      ...session.party[charIndex],
      ...characterData,
      avatarUrl: avatarResult.url,
      avatarPrompt: avatarResult.prompt,
      avatarStorageKey: avatarResult.storageKey,
      avatarStorageProvider: avatarResult.storageProvider,
    };

    session.party[charIndex] = updatedChar;
    await StateService.updateSession(sessionId, session);
    broadcastUpdate(sessionId, 'party_update', { session });
    broadcastSessionChanged(req.namespaceId, sessionId, 'updated');
    triggerPreviewRegen(sessionId, session.useLocalAI, req.namespaceId);
    res.json(updatedChar);
  }));

  router.get('/character/:charId/history-summary', asyncHandler(async (req, res) => {
    const charId = req.params.charId as string;
    const turns = StateService.getCharacterTurnHistory(charId);
    if (turns.length === 0) {
      res.json({ summary: null });
      return;
    }
    const session = await StateService.listSessions(req.namespaceId);
    const useLocalAI = false;
    const sessionWithChar = session.find(s => s.party.some(p => p.id === charId));
    const narrationContext = turns.slice(-10).map(t => t.narration).join(' ');
    const { client, model } = createChatClient(useLocalAI);
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: `/no_think Summarize in one sentence how this adventurer performed in their past adventure${sessionWithChar ? ` in "${sessionWithChar.displayName}"` : ''}: ${narrationContext}. Focus on their notable actions. Reply with just the sentence, no preamble.` }],
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
    const session = await StateService.getSession(sessionId as string);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    StateService.deleteCharacter(charId as string);
    broadcastUpdate(sessionId as string, 'party_update', { session });
    broadcastSessionChanged(req.namespaceId, sessionId as string, 'updated');
    triggerPreviewRegen(sessionId as string, session.useLocalAI, req.namespaceId);
    res.json({ success: true });
  }));

  return router;
};
