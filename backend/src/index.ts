import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(import.meta.dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import { EventEmitter } from 'events';
import { StateService } from './services/stateService.js';
import { GameEngine } from './services/gameEngine.js';
import { AiDmService } from './services/aiDmService.js';
import { ImageService } from './services/imageService.js';
import { createChatClient } from './ai/AiProviderFactory.js';
import { Character } from './types.js';

import Database from 'better-sqlite3';

const db = new Database('./database.sqlite');

import asyncHandler from 'express-async-handler';

const app = express();
const PORT = process.env.PORT || 3001;
const eventEmitter = new EventEmitter();

app.use(cors());
app.use(express.json());
app.use('/api/images', express.static(path.join(import.meta.dirname, '..', 'public', 'images')));

// SSE Event Stream
app.get('/api/session/:id/events', (req, res) => {
  const sessionId = req.params.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const onUpdate = (data: Record<string, unknown>) => {
    if (data.sessionId === sessionId) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  eventEmitter.on('update', onUpdate);

  req.on('close', () => {
    eventEmitter.off('update', onUpdate);
  });
});

app.get('/api/sessions', asyncHandler(async (req, res) => {
  const sessions = await StateService.listSessions();
  res.json(sessions);
}));

app.get('/api/characters/all', asyncHandler(async (req, res) => {
  const characters = await StateService.listAllCharacters();
  // Fetch session names for all characters
  const sessions = await StateService.listSessions();
  const sessionMap = new Map(sessions.map(s => [s.id, s.displayName]));

  const enhancedCharacters = await Promise.all(characters.map(async (char) => {
    const sessionId = await StateService.getSessionIdForCharacter(char.id);
    return { ...char, sessionName: sessionId ? sessionMap.get(sessionId) : 'Unknown' };
  }));
  res.json(enhancedCharacters);
}));

app.delete('/api/session/:id', asyncHandler(async (req, res) => {
  await StateService.deleteSession(req.params.id as string);
  res.json({ success: true });
}));

// Broadcast Helper
const broadcastUpdate = (sessionId: string, type: string, payload: Record<string, unknown>) => {
  eventEmitter.emit('update', { sessionId, type, ...payload });
};

// API Endpoints
app.post('/api/session/create', asyncHandler(async (req, res) => {
  const { worldDescription, difficulty, useLocalAI } = req.body;
  try {
    const session = await StateService.createSession(worldDescription, difficulty, !!useLocalAI);
    res.json(session);
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 429) {
      res.status(429).json({ error: 'rate_limit', message: 'The AI is overwhelmed with requests. Wait a moment and try again.' });
      return;
    }
    throw error;
  }
}));

app.delete('/api/session/:id', asyncHandler(async (req, res) => {
  await StateService.deleteSession(req.params.id as string);
  res.json({ success: true });
  return;
}));

app.get('/api/session/:id', asyncHandler(async (req, res) => {
  const session = await StateService.getSession(req.params.id as string);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
}));

app.post('/api/character/create', asyncHandler(async (req, res) => {
  const { sessionId, characterData } = req.body;
  const session = await StateService.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { url: avatarUrl, prompt: avatarPrompt } = await ImageService.generateAvatar(characterData, sessionId, session.useLocalAI);

  const character: Character = {
    id: Math.random().toString(36).substring(7),
    hp: 10,
    max_hp: 10,
    inventory: [],
    avatarUrl,
    avatarPrompt,
    ...characterData
  };

  db.prepare('INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, avatarUrl, avatarPrompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(character.id, sessionId, character.name, character.class, character.species, character.quirk, character.hp, character.max_hp, characterData.stats.might, characterData.stats.magic, characterData.stats.mischief, character.avatarUrl, character.avatarPrompt);

  session.party.push(character);
  if (!session.activeCharacterId) {
    session.activeCharacterId = character.id;
  }
  await StateService.updateSession(sessionId, session);
  broadcastUpdate(sessionId, 'party_update', { session });
  res.json(character);
}));

app.put('/api/character/:charId', asyncHandler(async (req, res) => {
  const { sessionId, characterData } = req.body;
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

  // Generate new avatar
  const { url: avatarUrl, prompt: avatarPrompt } = await ImageService.generateAvatar(characterData, sessionId, session.useLocalAI);
  const updatedChar = { ...session.party[charIndex], ...characterData, avatarUrl, avatarPrompt };

  session.party[charIndex] = updatedChar;
  await StateService.updateSession(sessionId, session);
  broadcastUpdate(sessionId, 'party_update', { session });
  res.json(updatedChar);
}));

app.delete('/api/session/:sessionId/character/:charId', asyncHandler(async (req, res) => {
  const { sessionId, charId } = req.params;
  const session = await StateService.getSession(sessionId as string);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // Delete from DB
  db.prepare('DELETE FROM characters WHERE id = ?').run(charId);
  db.prepare('DELETE FROM inventory WHERE characterId = ?').run(charId);

  broadcastUpdate(sessionId as string, 'party_update', { session });
  res.json({ success: true });
}));

app.get('/api/session/:id/summary', asyncHandler(async (req, res) => {
  const session = await StateService.getSession(req.params.id as string);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const history = await StateService.getTurnHistory(req.params.id as string);
  const prompt = `Summarize the adventure so far in 3 sentences, focusing on the main plot points: ${history.map(h => h.narration).join(' ')}`;
  const { client, model } = createChatClient(session.useLocalAI);
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
    }, { signal: AbortSignal.timeout(20_000) });
    const msg = response.choices[0].message;
    const content = msg.content || (msg as unknown as Record<string, string>)['reasoning_content'] || '';
    res.json({ summary: content });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 429) {
      res.status(429).json({ error: 'rate_limit', message: 'The AI is overwhelmed with requests. Wait a moment and try again.' });
      return;
    }
    console.error('[Summary] Failed:', err);
    res.json({ summary: 'The adventure was too legendary to put into words.' });
  }
}));

app.post('/api/session/:id/action', asyncHandler(async (req, res) => {
  const { action, statUsed, difficulty, characterId } = req.body;
  const sessionId = req.params.id as string;
  const session = await StateService.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const character = session.party.find(c => c.id === characterId) || session.party.find(c => c.id === session.activeCharacterId) || session.party[0];
  if (!character) {
    res.status(400).json({ error: 'No character in session' });
    return;
  }

  broadcastUpdate(sessionId, 'dm_narrating', {});

  const actionAttempt = GameEngine.resolveAction(character, action, statUsed, difficulty || 'normal');
  const aiInput = { ...session, ...actionAttempt };

  let turnResult;
  try {
    turnResult = await AiDmService.generateTurnResult(aiInput, session.useLocalAI);
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 429) {
      res.status(429).json({ error: 'rate_limit', message: 'The AI is overwhelmed with requests. Wait a moment and try again.' });
      return;
    }
    throw error;
  }

  const newState = GameEngine.updateState(session, actionAttempt, turnResult as unknown as Record<string, unknown>);
  await StateService.updateSession(sessionId, newState);

  turnResult.lastAction = actionAttempt;

  await StateService.addTurnResult(sessionId, turnResult, characterId);
  broadcastUpdate(sessionId, 'turn_complete', { session: newState, turnResult });
  res.json({ actionAttempt, turnResult, session: newState });

  console.log(`[Action] imageSuggested=${turnResult.imageSuggested} imagePrompt=${turnResult.imagePrompt ?? 'null'} savingsMode=${session.savingsMode}`);
  if (!session.savingsMode && turnResult.imageSuggested && turnResult.imagePrompt) {
    void ImageService.generateImage(turnResult.imagePrompt, session.id, newState.turn, session.useLocalAI).then(async imageUrl => {
      if (imageUrl) {
        await StateService.updateLatestTurnImageUrl(sessionId, imageUrl);
        broadcastUpdate(sessionId, 'image_ready', { imageUrl });
      }
    }).catch(err => console.error('[Action] Background image generation failed:', err));
  }
}));

app.get('/api/session/:id/history', asyncHandler(async (req, res) => {
  const history = await StateService.getTurnHistory(req.params.id as string);
  res.json(history);
}));
app.post('/api/session/:id/start', asyncHandler(async (req, res) => {
  const sessionId = req.params.id as string;
  const session = await StateService.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // Check if history already exists
  const history = await StateService.getTurnHistory(sessionId);
  if (history.length > 0) {
    res.json({ success: true, message: 'Already started' });
    return;
  }

  // Initial turn: "Adventure begins!"
  let initialTurn;
  try {
    initialTurn = await AiDmService.generateTurnResult({ ...session, actionAttempt: "Adventure begins!", actionResult: { success: true, roll: 20, statUsed: 'none' } }, session.useLocalAI);
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 429) {
      res.status(429).json({ error: 'rate_limit', message: 'The AI is overwhelmed with requests. Wait a moment and try again.' });
      return;
    }
    throw error;
  }
  await StateService.addTurnResult(sessionId, initialTurn, null);
  broadcastUpdate(sessionId, 'turn_complete', { session, turnResult: initialTurn });
  res.json({ success: true });

  if (!session.savingsMode) {
    void ImageService.generateImage(initialTurn.imagePrompt || 'A fantasy world map', sessionId, session.turn, session.useLocalAI).then(async imageUrl => {
      if (imageUrl) {
        await StateService.updateLatestTurnImageUrl(sessionId, imageUrl);
        broadcastUpdate(sessionId, 'image_ready', { imageUrl });
      }
    }).catch(err => console.error('[Start] Background image generation failed:', err));
  }
}));

app.post('/api/session/:id/savings-mode', asyncHandler(async (req, res) => {
  const { enabled } = req.body as { enabled: boolean };
  await StateService.setSavingsMode(req.params.id as string, enabled);
  res.json({ savingsMode: enabled });
}));

app.post('/api/session/:id/use-local-ai', asyncHandler(async (req, res) => {
  const { enabled } = req.body as { enabled: boolean };
  await StateService.setUseLocalAI(req.params.id as string, enabled);
  res.json({ useLocalAI: enabled });
}));

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
