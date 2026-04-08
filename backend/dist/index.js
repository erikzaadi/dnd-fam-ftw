import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { EventEmitter } from 'events';
import { StateService } from './services/stateService.js';
import { GameEngine } from './services/gameEngine.js';
import { AiDmService } from './services/aiDmService.js';
import { ImageService } from './services/imageService.js';
import OpenAI from 'openai';
import Database from 'better-sqlite3';
dotenv.config({ path: '../.env' });
const db = new Database('./database.sqlite');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
    const onUpdate = (data) => {
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
    await StateService.deleteSession(req.params.id);
    res.json({ success: true });
}));
// Broadcast Helper
const broadcastUpdate = (sessionId, type, payload) => {
    eventEmitter.emit('update', { sessionId, type, ...payload });
};
// API Endpoints
app.post('/api/session/create', asyncHandler(async (req, res) => {
    const { worldDescription, difficulty } = req.body;
    const session = await StateService.createSession(worldDescription, difficulty);
    res.json(session);
}));
app.delete('/api/session/:id', asyncHandler(async (req, res) => {
    await StateService.deleteSession(req.params.id);
    res.json({ success: true });
    return;
}));
app.get('/api/session/:id', asyncHandler(async (req, res) => {
    const session = await StateService.getSession(req.params.id);
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
    const avatarUrl = await ImageService.generateAvatar(characterData, sessionId);
    const character = {
        id: Math.random().toString(36).substring(7),
        hp: 10,
        max_hp: 10,
        inventory: [],
        avatarUrl,
        ...characterData
    };
    db.prepare('INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, avatarUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(character.id, sessionId, character.name, character.class, character.species, character.quirk, character.hp, character.max_hp, characterData.stats.might, characterData.stats.magic, characterData.stats.mischief, character.avatarUrl);
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
    const avatarUrl = await ImageService.generateAvatar(characterData, sessionId);
    const updatedChar = { ...session.party[charIndex], ...characterData, avatarUrl };
    session.party[charIndex] = updatedChar;
    await StateService.updateSession(sessionId, session);
    broadcastUpdate(sessionId, 'party_update', { session });
    res.json(updatedChar);
}));
app.delete('/api/session/:sessionId/character/:charId', asyncHandler(async (req, res) => {
    const { sessionId, charId } = req.params;
    const session = await StateService.getSession(sessionId);
    if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
    }
    // Delete from DB
    db.prepare('DELETE FROM characters WHERE id = ?').run(charId);
    db.prepare('DELETE FROM inventory WHERE characterId = ?').run(charId);
    broadcastUpdate(sessionId, 'party_update', { session });
    res.json({ success: true });
}));
app.get('/api/session/:id/summary', asyncHandler(async (req, res) => {
    const history = await StateService.getTurnHistory(req.params.id);
    const prompt = `Summarize the adventure so far in 3 sentences, focusing on the main plot points: ${history.map(h => h.narration).join(' ')}`;
    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }]
    });
    res.json({ summary: response.choices[0].message.content });
}));
app.post('/api/session/:id/action', asyncHandler(async (req, res) => {
    const { action, statUsed, difficulty, characterId } = req.body;
    const sessionId = req.params.id;
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
    const actionAttempt = GameEngine.resolveAction(character, action, statUsed, difficulty || 'normal');
    const aiInput = { ...session, ...actionAttempt };
    const turnResult = await AiDmService.generateTurnResult(aiInput);
    const newState = GameEngine.updateState(session, actionAttempt, turnResult);
    await StateService.updateSession(sessionId, newState);
    turnResult.lastAction = actionAttempt;
    if (turnResult.imageSuggested && turnResult.imagePrompt) {
        turnResult.imageUrl = await ImageService.generateImage(turnResult.imagePrompt, session.id, newState.sceneId);
    }
    else {
        turnResult.imageUrl = turnResult.imageUrl || ImageService.getDefaultImage();
    }
    await StateService.addTurnResult(sessionId, turnResult, characterId);
    broadcastUpdate(sessionId, 'turn_complete', { session: newState, turnResult });
    res.json({ actionAttempt, turnResult, session: newState });
}));
app.get('/api/session/:id/history', asyncHandler(async (req, res) => {
    const history = await StateService.getTurnHistory(req.params.id);
    res.json(history);
}));
app.post('/api/session/:id/start', asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
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
    const initialTurn = await AiDmService.generateTurnResult({ ...session, actionAttempt: "Adventure begins!", actionResult: { success: true, roll: 20, statUsed: 'none' } });
    initialTurn.imageUrl = await ImageService.generateImage(initialTurn.imagePrompt || "A fantasy world map", sessionId, session.sceneId);
    await StateService.addTurnResult(sessionId, initialTurn, "");
    broadcastUpdate(sessionId, 'turn_complete', { session, turnResult: initialTurn });
    res.json({ success: true });
}));
app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
});
