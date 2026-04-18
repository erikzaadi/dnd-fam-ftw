import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.join(import.meta.dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { EventEmitter } from 'events';
import { StateService } from './services/stateService.js';
import { GameEngine } from './services/gameEngine.js';
import { AiDmService } from './services/aiDmService.js';
import { ImageService } from './services/imageService.js';
import { createChatClient } from './providers/ai/AiProviderFactory.js';
import { SettingsService } from './services/settingsService.js';
import { StorySummaryService } from './services/storySummaryService.js';
import { parseSuggestedStats, STAT_FALLBACK } from './services/statSuggestionService.js';
import { Character } from './types.js';
import { getConfig, isAuthEnabled } from './config/env.js';
import { getImageStorageProvider } from './providers/storage/storageProviderFactory.js';
import { getAuthPublicConfig, buildGoogleAuthUrl, exchangeCodeForEmail, signJwt } from './services/authService.js';
import { authMiddleware } from './middleware/auth.js';

import asyncHandler from 'express-async-handler';

const app = express();
const PORT = process.env.PORT || 3001;
const eventEmitter = new EventEmitter();

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/images', express.static(path.join(import.meta.dirname, '..', 'public', 'images')));

const config = getConfig();
const generatedDir = path.resolve(config.LOCAL_IMAGE_STORAGE_PATH);
fs.mkdirSync(generatedDir, { recursive: true });
app.use(config.LOCAL_IMAGE_PUBLIC_BASE_URL, express.static(generatedDir));

// Bootstrap admin user if ADMIN_EMAIL is set and auth is enabled
StateService.initialize();
if (isAuthEnabled()) {
  console.log(`[Auth] Enabled - Google OAuth active, callback: ${config.GOOGLE_CALLBACK_URL}`);
  if (config.ADMIN_EMAIL) {
    StateService.ensureAdminUser(config.ADMIN_EMAIL);
  }
} else {
  console.log('[Auth] Disabled - no GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/JWT_SECRET in env, all requests use local namespace');
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// --- Auth routes (public - no auth middleware) ---

app.get('/auth/config', (_req, res) => {
  res.json(getAuthPublicConfig());
});

app.get('/auth/me', (req, res, next) => authMiddleware(req, res, next), (req, res) => {
  if (!isAuthEnabled()) {
    res.json({ enabled: false, email: null, namespaceId: 'local' });
    return;
  }
  res.json({ enabled: true, email: req.userEmail, namespaceId: req.namespaceId });
});

app.get('/auth/google', (_req, res) => {
  if (!isAuthEnabled()) {
    res.status(404).json({ error: 'Auth not configured' });
    return;
  }
  const state = Math.random().toString(36).substring(7);
  res.redirect(buildGoogleAuthUrl(state));
});

app.get('/auth/google/callback', asyncHandler(async (req, res) => {
  if (!isAuthEnabled()) {
    res.status(404).json({ error: 'Auth not configured' });
    return;
  }

  const code = req.query.code as string;
  if (!code) {
    res.status(400).json({ error: 'Missing code' });
    return;
  }

  const email = await exchangeCodeForEmail(code);
  const user = StateService.getUserByEmail(email);
  if (!user) {
    console.warn(`[Auth] Login denied for unregistered email: ${email}`);
    const basePath = config.APP_BASE_PATH;
    res.redirect(`${config.FRONTEND_URL ?? ''}${basePath}login?error=unauthorized`);
    return;
  }

  const token = signJwt({ email: user.email, namespaceId: user.namespace_id });
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('jwt', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/',
  });

  const frontendUrl = config.FRONTEND_URL ?? '';
  const basePath = config.APP_BASE_PATH;
  res.redirect(`${frontendUrl}${basePath}`);
}));

app.post('/auth/logout', (_req, res) => {
  res.clearCookie('jwt', { path: '/' });
  res.json({ ok: true });
});

// Apply auth middleware to all routes except /auth/* /images/* and /health
app.use((req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path.startsWith('/images/') || req.path === '/health') {
    next();
    return;
  }
  authMiddleware(req, res, next);
});

// SSE Event Stream
app.get('/session/:id/events', (req, res) => {
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

app.get('/sessions', asyncHandler(async (req, res) => {
  const sessions = await StateService.listSessions(req.namespaceId);
  res.json(sessions);
}));

app.get('/characters/all', asyncHandler(async (_req, res) => {
  const characters = await StateService.listAllCharacters();
  const sessions = await StateService.listSessions();
  const sessionMap = new Map(sessions.map(s => [s.id, s.displayName]));

  const enhancedCharacters = await Promise.all(characters.map(async (char) => {
    const sessionId = await StateService.getSessionIdForCharacter(char.id);
    return { ...char, sessionName: sessionId ? sessionMap.get(sessionId) : 'Unknown' };
  }));
  res.json(enhancedCharacters);
}));

app.delete('/session/:id', asyncHandler(async (req, res) => {
  await StateService.deleteSession(req.params.id as string);
  res.json({ success: true });
}));

app.get('/settings', (_req, res) => {
  res.json(SettingsService.get());
});

app.post('/settings', asyncHandler(async (req, res) => {
  const settings = SettingsService.save(req.body);
  res.json(settings);
}));

// Broadcast Helper
const broadcastUpdate = (sessionId: string, type: string, payload: Record<string, unknown>) => {
  eventEmitter.emit('update', { sessionId, type, ...payload });
};

// API Endpoints
app.post('/session/create', asyncHandler(async (req, res) => {
  const { worldDescription, difficulty, useLocalAI } = req.body;
  try {
    const savingsMode = !SettingsService.get().imagesEnabled;
    const session = await StateService.createSession(worldDescription, difficulty, !!useLocalAI, savingsMode, req.namespaceId);
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

app.get('/session/:id', asyncHandler(async (req, res) => {
  const session = await StateService.getSession(req.params.id as string);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
}));

app.post('/session/:id/suggest-stat', asyncHandler(async (req, res) => {
  const { action, characterClass, characterQuirk } = req.body as { action: string; characterClass?: string; characterQuirk?: string };
  const session = await StateService.getSession(req.params.id as string);
  if (!session) {
    res.status(404).json({ stat: 'mischief' }); return;
  }

  const { client, model } = createChatClient(session.useLocalAI);
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{
        role: 'user',
        content: `/no_think A fantasy RPG character${characterClass ? ` (${characterClass})` : ''}${characterQuirk ? `, quirk: ${characterQuirk}` : ''} wants to: "${action}". Which single stat fits best: might (physical strength, combat, force), magic (spells, arcane, healing, divine), or mischief (stealth, trickery, charm, persuasion, deception)? Reply with ONLY one word: might, magic, or mischief.`
      }],
      max_tokens: 10,
    }, { signal: AbortSignal.timeout(8_000) });
    const raw = (response.choices[0].message.content ?? '').toLowerCase().trim().replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const stat = ['might', 'magic', 'mischief'].find(s => raw.includes(s)) ?? 'mischief';
    res.json({ stat });
  } catch {
    res.json({ stat: 'mischief' });
  }
}));

app.post('/character/suggest-stats', asyncHandler(async (req, res) => {
  const { name, class: charClass, species, quirk, useLocalAI } = req.body;
  const { client, model } = createChatClient(!!useLocalAI);
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{
        role: 'user',
        content: `/no_think Assign starting stats for a fantasy RPG character. Stats: might (physical), magic (arcane), mischief (cunning/charm). Distribute exactly 7 points total. Each stat: min 1, max 5. Rules: ALWAYS put the highest stat (4 or 5) in the primary archetype stat. Never distribute evenly (3/2/2 is bad). Archetypes: Fighter/Warrior/Barbarian/Knight = might 4-5. Mage/Wizard/Sorcerer/Witch = magic 4-5. Rogue/Thief/Bard/Trickster = mischief 4-5. Cleric/Druid = magic 3-4. Paladin = might 3-4. Let species and quirk shift the secondary stat. Examples: "Fighter Dwarf" = {"might":5,"magic":1,"mischief":1}. "Mage Elf" = {"might":1,"magic":5,"mischief":1}. "Rogue Halfling" = {"might":1,"magic":1,"mischief":5}. "Cleric Human" = {"might":2,"magic":4,"mischief":1}.

Character:
- Name: ${name}
- Class: ${charClass}
- Species: ${species}
- Quirk: ${quirk}

Reply with ONLY valid JSON: {"might": N, "magic": N, "mischief": N}`
      }],
      max_tokens: 60,
    }, { signal: AbortSignal.timeout(10_000) });

    const raw = response.choices[0].message.content ?? '';
    res.json(parseSuggestedStats(raw));
  } catch {
    res.json({ ...STAT_FALLBACK });
  }
}));

app.post('/character/create', asyncHandler(async (req, res) => {
  const { sessionId, characterData } = req.body;
  const session = await StateService.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const avatarResult = !session.savingsMode
    ? await ImageService.generateAvatar(characterData, sessionId, session.useLocalAI)
    : { url: ImageService.generateInitialsSvg(characterData.name, sessionId), prompt: '', storageKey: '', storageProvider: 'local' };

  const character: Character = {
    id: Math.random().toString(36).substring(7),
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
  res.json(character);
}));

app.put('/character/:charId', asyncHandler(async (req, res) => {
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
  res.json(updatedChar);
}));

app.delete('/session/:sessionId/character/:charId', asyncHandler(async (req, res) => {
  const { sessionId, charId } = req.params;
  const session = await StateService.getSession(sessionId as string);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  StateService.deleteCharacter(charId as string);

  broadcastUpdate(sessionId as string, 'party_update', { session });
  res.json({ success: true });
}));

app.get('/session/:id/summary', asyncHandler(async (req, res) => {
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

app.post('/session/:id/action', asyncHandler(async (req, res) => {
  const { action, statUsed, difficulty, difficultyValue, characterId, actionType, itemId, targetCharacterId } = req.body;
  const sessionId = req.params.id as string;
  const session = await StateService.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const actingCharId = characterId || session.activeCharacterId;
  const character = session.party.find(c => c.id === actingCharId) || session.party[0];
  if (!character) {
    res.status(400).json({ error: 'No character in session' });
    return;
  }

  broadcastUpdate(sessionId, 'dm_narrating', {});

  if (actionType === 'use_item' || actionType === 'give_item') {
    const targetId = targetCharacterId || actingCharId;
    const { newState: itemState, actionAttempt: itemAttempt, error } = actionType === 'use_item'
      ? GameEngine.applyItemUse(session, actingCharId, itemId, targetId)
      : GameEngine.applyGiveItem(session, actingCharId, itemId, targetId);

    if (error) {
      res.status(400).json({ error });
      return;
    }

    const aiInput = { ...itemState, ...itemAttempt };
    let turnResult;
    try {
      turnResult = await AiDmService.generateTurnResult(aiInput, session.useLocalAI);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 429) {
        res.status(429).json({ error: 'rate_limit', message: 'The AI is overwhelmed with requests. Wait a moment and try again.' });
        return;
      }
      throw err;
    }

    const newState = GameEngine.updateState(itemState, itemAttempt, turnResult as unknown as Record<string, unknown>);
    await StateService.updateSession(sessionId, newState);
    turnResult.lastAction = itemAttempt;
    turnResult.characterId = actingCharId;
    await StateService.addTurnResult(sessionId, turnResult, actingCharId);
    broadcastUpdate(sessionId, 'turn_complete', { session: newState, turnResult });
    res.json({ actionAttempt: itemAttempt, turnResult, session: newState });
    return;
  }

  if (character.status === 'downed') {
    res.status(400).json({ error: 'downed', message: `${character.name} is downed and cannot act.` });
    return;
  }

  const actionAttempt = GameEngine.resolveAction(character, action, statUsed, difficulty || 'normal', difficultyValue);
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
  turnResult.characterId = actingCharId;

  await StateService.addTurnResult(sessionId, turnResult, actingCharId);
  broadcastUpdate(sessionId, 'turn_complete', { session: newState, turnResult });
  res.json({ actionAttempt, turnResult, session: newState });

  setImmediate(() => void StorySummaryService.maybeUpdate(sessionId, newState.turn, session.useLocalAI));

  if (GameEngine.isPartyWiped(newState) && !newState.interventionState?.used) {
    void (async () => {
      try {
        console.log('[Intervention] Party wiped — triggering intervention rescue');
        const rescuedState = GameEngine.applyIntervention(newState);
        await StateService.updateSession(sessionId, rescuedState);

        const interventionInput: import('./types.js').AIInput = {
          ...rescuedState,
          actionAttempt: 'A mysterious force saved the party from doom',
          actionResult: { success: true, roll: 0, statUsed: 'none' },
          interventionRescue: true,
        };
        const interventionTurn = await AiDmService.generateTurnResult(interventionInput, session.useLocalAI);
        interventionTurn.turnType = 'intervention';
        interventionTurn.imageUrl = '/images/intervention_dragon.png';

        const postState = GameEngine.updateState(rescuedState, interventionInput, interventionTurn as unknown as Record<string, unknown>);
        await StateService.updateSession(sessionId, postState);
        await StateService.addTurnResult(sessionId, interventionTurn, null);
        broadcastUpdate(sessionId, 'intervention', { session: postState, turnResult: interventionTurn });
        setImmediate(() => void StorySummaryService.updateAfterIntervention(sessionId, interventionTurn.narration, session.useLocalAI));
        console.log('[Intervention] Rescue complete');
      } catch (err) {
        console.error('[Intervention] Failed:', err);
      }
    })();
  }

  if (GameEngine.isPartyWiped(newState) && newState.interventionState?.used) {
    void (async () => {
      try {
        console.log('[Sanctuary] Second wipe — triggering sanctuary recovery');
        const sanctuaryState = GameEngine.applySanctuaryRecovery(newState);
        await StateService.updateSession(sessionId, sanctuaryState);

        const sanctuaryInput: import('./types.js').AIInput = {
          ...sanctuaryState,
          actionAttempt: 'The party woke up somewhere safe, battered but alive',
          actionResult: { success: true, roll: 0, statUsed: 'none' },
          sanctuaryRecovery: true,
        };
        const sanctuaryTurn = await AiDmService.generateTurnResult(sanctuaryInput, session.useLocalAI);
        sanctuaryTurn.turnType = 'sanctuary';
        sanctuaryTurn.imageUrl = '/images/sanctuary_light.png';

        const postState = GameEngine.updateState(sanctuaryState, sanctuaryInput, sanctuaryTurn as unknown as Record<string, unknown>);
        await StateService.updateSession(sessionId, postState);
        await StateService.addTurnResult(sessionId, sanctuaryTurn, null);
        broadcastUpdate(sessionId, 'sanctuary_recovery', { session: postState, turnResult: sanctuaryTurn });
        setImmediate(() => void StorySummaryService.updateAfterIntervention(sessionId, sanctuaryTurn.narration, session.useLocalAI));
        console.log('[Sanctuary] Recovery complete');
      } catch (err) {
        console.error('[Sanctuary] Failed:', err);
      }
    })();
  }

  console.log(`[Action] imageSuggested=${turnResult.imageSuggested} imagePrompt=${turnResult.imagePrompt ?? 'null'} savingsMode=${session.savingsMode}`);
  if (!session.savingsMode && turnResult.imageSuggested && turnResult.imagePrompt) {
    void ImageService.generateImage(turnResult.imagePrompt, session.id, newState.turn, session.useLocalAI).then(async result => {
      if (result) {
        await StateService.updateLatestTurnImage(sessionId, result.url, result.storageKey, result.storageProvider);
        broadcastUpdate(sessionId, 'image_ready', { imageUrl: result.url });
      }
    }).catch(err => console.error('[Action] Background image generation failed:', err));
  }
}));

app.get('/session/:id/history', asyncHandler(async (req, res) => {
  const history = await StateService.getTurnHistory(req.params.id as string);
  res.json(history);
}));

app.post('/session/:id/start', asyncHandler(async (req, res) => {
  const sessionId = req.params.id as string;
  const session = await StateService.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const history = await StateService.getTurnHistory(sessionId);
  if (history.length > 0) {
    res.json({ success: true, message: 'Already started' });
    return;
  }

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
    void ImageService.generateImage(initialTurn.imagePrompt || 'A fantasy world map', sessionId, session.turn, session.useLocalAI).then(async result => {
      if (result) {
        await StateService.updateLatestTurnImage(sessionId, result.url, result.storageKey, result.storageProvider);
        broadcastUpdate(sessionId, 'image_ready', { imageUrl: result.url });
      }
    }).catch(err => console.error('[Start] Background image generation failed:', err));
  }
}));

app.post('/session/:id/savings-mode', asyncHandler(async (req, res) => {
  const { enabled } = req.body as { enabled: boolean };
  await StateService.setSavingsMode(req.params.id as string, enabled);
  res.json({ savingsMode: enabled });
}));

app.post('/session/:id/use-local-ai', asyncHandler(async (req, res) => {
  const { enabled } = req.body as { enabled: boolean };
  await StateService.setUseLocalAI(req.params.id as string, enabled);
  res.json({ useLocalAI: enabled });
}));

async function startup() {
  console.log(`[Config] Persistence: sqlite @ ${config.SQLITE_DB_PATH}`);
  console.log(`[Config] Image storage: ${config.IMAGE_STORAGE_PROVIDER}`);

  if (config.IMAGE_STORAGE_PROVIDER === 's3') {
    const provider = getImageStorageProvider();
    if (provider.validateSetup) {
      await provider.validateSetup();
    }
  }

  app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
  });
}

startup().catch(err => {
  console.error('[Startup] Fatal error:', err);
  process.exit(1);
});
