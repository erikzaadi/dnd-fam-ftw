import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { broadcastSessionChanged, broadcastSessionListUpdate, broadcastSessionUpdated, broadcastUpdate } from '../realtime/sessionEvents.js';
import { buildInstantStartParty, runInstantStartBackground } from '../services/instantStartService.js';
import { pickWorldSeed } from '../data/instantStartArchetypes.js';
import { createQuickStartId } from '../lib/ids.js';
import { ImageService } from '../services/imageService.js';
import { SettingsService } from '../services/settingsService.js';
import { StateService } from '../services/stateService.js';
import { refreshDmPrepImageBriefAndPreview, triggerPreviewRegen } from '../services/sessionPreviewService.js';
import { StorySummaryService } from '../services/storySummaryService.js';
import { RealmOriginStoryService } from '../services/realmOriginStoryService.js';
import { ADVENTURE_FORMAT_VALUES, GAME_MODE_VALUES, type GameMode } from '../types.js';
import { changeAdventureFormat } from '../services/adventureLifecycleService.js';
import { ensureEveningObjective, refreshChapterPayoff } from '../services/adventureObjectiveService.js';
import { sendRateLimitResponse } from './routeErrors.js';
import { booleanBodySchema, parseBody } from './routeValidation.js';
import { registerSessionIdParam } from '../middleware/sessionParam.js';
import { runBackground } from '../middleware/runBackground.js';
import { sessionRepository, type SessionPatch } from '../repositories/sessionRepository.js';
import { operationRepository } from '../repositories/operationRepository.js';
import { applyGuardedSessionMutation } from '../services/sessionMutationService.js';
import { acceptSessionOperation, respondToAcceptance, runSessionOperation } from '../services/sessionOperationService.js';
import { generateAndCommitInitialTurn } from '../services/initialTurnService.js';
import { attachTurnImage } from '../services/turnSideEffectService.js';
import { toPublicSession } from '../services/sessionProjection.js';
import { getEffectiveLimits } from '../services/usageLimitService.js';

const createSessionBodySchema = z.object({
  worldDescription: z.string().optional(),
  difficulty: z.string().optional(),
  gameMode: z.enum(GAME_MODE_VALUES).optional(),
  dmPrep: z.string().optional(),
  // Omitted by older clients: new sessions still default to one evening.
  adventureFormat: z.enum(ADVENTURE_FORMAT_VALUES).optional(),
});

const patchSessionBodySchema = z.object({
  difficulty: z.string().optional(),
  gameMode: z.string().optional(),
  dmPrep: z.string().optional(),
  worldDescription: z.string().optional(),
  adventureFormat: z.enum(ADVENTURE_FORMAT_VALUES).optional(),
  // Realm setting "Suggest ideas each turn".
  autoIdeas: z.boolean().optional(),
  expectedRevision: z.number().int().min(0).optional(),
});

const regenerateDmPrepBodySchema = z.object({
  difficulty: z.string().optional(),
  gameMode: z.string().optional(),
  worldDescription: z.string().optional(),
}).optional();

export const createSessionRouter = () => {
  const router = Router();
  registerSessionIdParam(router);

  router.get('/sessions', asyncHandler(async (req, res) => {
    const sessions = await StateService.listSessions(req.namespaceId);
    res.json(sessions);
  }));

  router.post('/session/quick-start', asyncHandler(async (req, res) => {
    const limits = getEffectiveLimits(req.namespaceId);
    if (limits.maxSessions !== null) {
      const count = StateService.countSessionsInNamespace(req.namespaceId);
      if (count >= limits.maxSessions) {
        res.status(403).json({ error: 'session_limit', message: `Your group has reached its limit of ${limits.maxSessions} realm(s). Delete an old realm to start a new one.` });
        return;
      }
    }
    const id = StateService.cloneOnboardingSession(req.namespaceId);
    broadcastSessionChanged(req.namespaceId, id, 'created');
    res.json({ id });
  }));

  router.post('/session/instant-start', asyncHandler(async (req, res) => {
    const limits = getEffectiveLimits(req.namespaceId);
    if (limits.maxSessions !== null) {
      const count = StateService.countSessionsInNamespace(req.namespaceId);
      if (count >= limits.maxSessions) {
        res.status(403).json({ error: 'session_limit', message: `Your group has reached its limit of ${limits.maxSessions} realm(s). Delete an old realm to start a new one.` });
        return;
      }
    }

    const settings = SettingsService.get(req.namespaceId);
    const savingsMode = !settings.imagesEnabled;
    const randomPace = Math.random() < 0.5 ? 'fast' : 'balanced';
    const seed = pickWorldSeed();
    const sessionId = createQuickStartId();

    const session = await StateService.createSession(
      seed.worldDescription,
      'normal',
      savingsMode,
      req.namespaceId,
      randomPace,
      undefined,
      seed.displayName,
      sessionId,
    );

    session.party = buildInstantStartParty(session.id);
    session.activeCharacterId = session.party[0].id;
    await StateService.updateSession(session.id, session);

    // Accept the opening turn as an operation before responding, so a player who opens
    // the session immediately sees it pending instead of an empty, actionable stage.
    const acceptance = acceptSessionOperation({
      sessionId: session.id,
      namespaceId: req.namespaceId,
      kind: 'start',
      payload: { kind: 'start' },
    });
    broadcastSessionChanged(req.namespaceId, session.id, 'created');
    res.json({ id: session.id, savingsMode });

    void runInstantStartBackground(session.id, session, req.namespaceId, seed, acceptance.type === 'accepted' ? acceptance.operation : null);
  }));

  router.delete('/session/:id', asyncHandler(async (req, res) => {
    const sessionId = req.params.id as string;
    await StateService.deleteSession(sessionId);
    broadcastSessionChanged(req.namespaceId, sessionId, 'deleted');
    res.json({ success: true });
  }));

  router.post('/session/create', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, createSessionBodySchema);
    if (!body) {
      return;
    }
    const { worldDescription, difficulty, gameMode, dmPrep } = body;
    const adventureFormat = body.adventureFormat ?? 'one_evening';
    try {
      const limits = getEffectiveLimits(req.namespaceId);
      if (limits.maxSessions !== null) {
        const count = StateService.countSessionsInNamespace(req.namespaceId);
        if (count >= limits.maxSessions) {
          res.status(403).json({ error: 'session_limit', message: `Your group has reached its limit of ${limits.maxSessions} realm(s). Delete an old realm to start a new one.` });
          return;
        }
      }
      const savingsMode = !SettingsService.get(req.namespaceId).imagesEnabled;
      const session = await StateService.createSession(worldDescription, difficulty, savingsMode, req.namespaceId, gameMode, dmPrep || undefined, undefined, undefined, adventureFormat);
      broadcastSessionChanged(req.namespaceId, session.id, 'created');
      if (dmPrep) {
        refreshDmPrepImageBriefAndPreview(session.id, dmPrep, req.namespaceId);
        if (adventureFormat === 'one_evening') {
          // Explicit format wins over prose about campaign length: long notes become
          // a bounded chapter within that world.
          runBackground(`evening-objective session=${session.id}`, () => ensureEveningObjective(session.id));
        }
      } else {
        runBackground(`campaign-brief session=${session.id}`, async () => {
          await StorySummaryService.generateCampaignBrief(
            session.id,
            worldDescription,
            session.displayName,
            difficulty,
            gameMode,
            { onMediaReady: () => triggerPreviewRegen(session.id, req.namespaceId), adventureFormat },
          );
        });
        triggerPreviewRegen(session.id, req.namespaceId);
      }
      res.json(session);
    } catch (error: unknown) {
      if (sendRateLimitResponse(res, error)) {
        return;
      }
      throw error;
    }
  }));

  router.get('/session/:id', asyncHandler(async (req, res) => {
    res.json(toPublicSession(req.session!));
  }));

  router.patch('/session/:id', asyncHandler(async (req, res) => {
    const session = req.session!;
    const sessionId = req.params.id as string;
    const body = parseBody(req, res, patchSessionBodySchema);
    if (!body) {
      return;
    }
    const { difficulty, gameMode, dmPrep, worldDescription, adventureFormat, autoIdeas, expectedRevision } = body;
    if (adventureFormat !== undefined && (!session.adventure || session.adventure.status !== 'active')) {
      res.status(409).json({ error: 'adventure_completed', message: 'The format of a finished adventure can be chosen when continuing the world.' });
      return;
    }
    const nextAdventure = adventureFormat !== undefined && session.adventure
      ? changeAdventureFormat(session.adventure, adventureFormat)
      : undefined;
    const patch: SessionPatch = {};
    if (difficulty !== undefined) {
      patch.difficulty = difficulty;
    }
    if (gameMode !== undefined) {
      patch.gameMode = gameMode as GameMode;
    }
    if (dmPrep !== undefined) {
      patch.dmPrep = dmPrep || null;
    }
    if (worldDescription !== undefined) {
      patch.worldDescription = worldDescription || null;
    }
    if (autoIdeas !== undefined) {
      patch.autoIdeas = autoIdeas;
    }
    const mutation = applyGuardedSessionMutation(sessionId, expectedRevision, () => {
      sessionRepository.patchSessionSync(sessionId, patch);
      if (nextAdventure) {
        sessionRepository.writeAdventureSync(sessionId, nextAdventure);
      }
    });
    if (!mutation.ok) {
      res.status(mutation.status).json(mutation.body);
      return;
    }
    broadcastSessionChanged(req.namespaceId, sessionId, 'updated');
    broadcastSessionUpdated(sessionId, mutation.revision, {
      ...(patch.difficulty !== undefined && { difficulty: patch.difficulty }),
      ...(patch.gameMode !== undefined && { gameMode: patch.gameMode }),
      ...(patch.autoIdeas !== undefined && { autoIdeas: patch.autoIdeas }),
      ...(nextAdventure && { adventure: nextAdventure }),
    });
    if (nextAdventure?.format === 'one_evening' && !nextAdventure.objective) {
      runBackground(`evening-objective session=${sessionId}`, () => ensureEveningObjective(sessionId));
    }
    if (dmPrep !== undefined) {
      refreshDmPrepImageBriefAndPreview(sessionId, dmPrep || null, req.namespaceId);
      // Mid-adventure DM Prep edits recompile only future intent, never progress.
      runBackground(`chapter-payoff session=${sessionId}`, () => refreshChapterPayoff(sessionId));
    } else if (worldDescription !== undefined) {
      // Settings-only patches (difficulty, pacing) never regenerate art.
      triggerPreviewRegen(sessionId, req.namespaceId);
    }
    res.json({
      id: session.id,
      revision: mutation.revision,
      difficulty: patch.difficulty ?? session.difficulty,
      gameMode: patch.gameMode ?? session.gameMode,
      dmPrep: patch.dmPrep !== undefined ? patch.dmPrep : session.dmPrep,
      worldDescription: patch.worldDescription !== undefined ? (patch.worldDescription ?? undefined) : session.worldDescription,
      autoIdeas: patch.autoIdeas ?? !!session.autoIdeas,
      ...(nextAdventure && { adventure: nextAdventure }),
    });
  }));

  router.post('/session/:id/preview-image', asyncHandler(async (req, res) => {
    const session = req.session!;
    if (session.savingsMode) {
      res.json({ previewImageUrl: null });
      return;
    }
    const result = await ImageService.generateSessionPreview(session);
    if (result) {
      StateService.updateSessionPreviewImage(session.id, result.url);
      broadcastUpdate(session.id, 'image_ready', { target: 'session_preview', imageUrl: result.url });
      broadcastSessionListUpdate(req.namespaceId, 'preview_image_available', { sessionId: session.id, previewImageUrl: result.url });
    }
    res.json({ previewImageUrl: result?.url ?? null });
  }));

  router.post('/session/:id/regenerate-dm-prep', asyncHandler(async (req, res) => {
    const session = req.session!;
    const body = parseBody(req, res, regenerateDmPrepBodySchema);
    if (body === undefined && req.body !== undefined && Object.keys(req.body as Record<string, unknown>).length > 0) {
      return;
    }
    const worldDescription = body?.worldDescription !== undefined ? (body.worldDescription || undefined) : session.worldDescription;
    const difficulty = body?.difficulty ?? session.difficulty;
    const gameMode = body?.gameMode ?? session.gameMode;
    const brief = await StorySummaryService.generateCampaignBrief(
      session.id,
      worldDescription,
      session.displayName,
      difficulty,
      gameMode,
      { mediaMode: 'inline', adventureFormat: session.adventure?.format },
    );
    if (!brief) {
      res.status(500).json({ error: 'Failed to generate campaign brief' });
      return;
    }
    const updated = await StateService.getSession(session.id);
    res.json({ dmPrep: brief, dmPrepEncounters: updated?.dmPrepEncounters ?? null });
  }));

  router.post('/session/:id/start', asyncHandler(async (req, res) => {
    const sessionId = req.params.id as string;
    const session = req.session!;

    const history = await StateService.getTurnHistory(sessionId);
    if (history.length > 0) {
      res.json({ success: true, message: 'Already started' });
      return;
    }

    // Starting is an operation like any other: a second concurrent start is rejected
    // by the session guard instead of generating a duplicate opening turn.
    const acceptance = acceptSessionOperation({
      sessionId,
      namespaceId: req.namespaceId,
      kind: 'start',
      payload: { kind: 'start' },
    });
    if (acceptance.type !== 'accepted') {
      respondToAcceptance(res, acceptance);
      return;
    }
    const operation = acceptance.operation;

    const started: { result?: NonNullable<Awaited<ReturnType<typeof generateAndCommitInitialTurn>>> } = {};
    await runSessionOperation(operation, async () => {
      const result = await generateAndCommitInitialTurn({ sessionId, operationId: operation.id });
      if (!result) {
        return { error: 'not_found', message: 'Session not found' };
      }
      started.result = result;
    });
    const finished = operationRepository.get(sessionId, operation.id);
    if (!started.result || finished?.status !== 'completed') {
      if (finished?.errorCode === 'rate_limit') {
        res.status(429).json({ error: 'rate_limit', message: finished.errorMessage });
        return;
      }
      res.status(500).json({ error: finished?.errorCode ?? 'turn_failed', message: finished?.errorMessage ?? 'Could not start the adventure. Please try again.' });
      return;
    }
    const { turn: initialTurn, state } = started.result;
    res.json({ success: true });

    if (!session.savingsMode && initialTurn.id) {
      const turnId = initialTurn.id;
      if (session.previewImageUrl) {
        await attachTurnImage(sessionId, turnId, { url: session.previewImageUrl, storageKey: '', storageProvider: '' });
      } else {
        runBackground(`start-image session=${sessionId}`, async () => {
          const result = await ImageService.generateImage(
            initialTurn.imagePrompt || 'A fantasy realm establishing scene',
            sessionId,
            state.turn,
            undefined,
            undefined,
            {
              worldDescription: state.worldDescription,
              dmPrepImageBrief: state.dmPrepImageBrief,
              party: state.party,
              activeCharacterId: state.activeCharacterId,
              currentTensionLevel: initialTurn.currentTensionLevel,
            },
          );
          if (result) {
            await attachTurnImage(sessionId, turnId, result);
          }
        });
      }
    }
  }));

  router.get('/session/:id/origin-story', asyncHandler(async (req, res) => {
    const session = req.session!;
    res.json({
      originStory: session.originStory ?? null,
      originStoryImageUrl: session.originStoryImageUrl ?? null,
    });
  }));

  router.post('/session/:id/origin-story', asyncHandler(async (req, res) => {
    const session = req.session!;
    if (!session.party.length) {
      res.status(400).json({ error: 'No party members' });
      return;
    }
    if (session.originStory) {
      res.json({ originStory: session.originStory });
      return;
    }
    const originStory = await RealmOriginStoryService.generate(session.id);
    res.json({ originStory });
  }));

  router.post('/session/:id/savings-mode', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, booleanBodySchema);
    if (!body) {
      return;
    }
    const { enabled } = body;
    await StateService.setSavingsMode(req.params.id as string, enabled);
    res.json({ savingsMode: enabled });
  }));

  return router;
};
