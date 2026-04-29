import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { broadcastSessionChanged, broadcastSessionListUpdate, broadcastUpdate } from '../realtime/sessionEvents.js';
import { AiDmService } from '../services/aiDmService.js';
import { ImageService } from '../services/imageService.js';
import { SettingsService } from '../services/settingsService.js';
import { StateService } from '../services/stateService.js';
import { refreshDmPrepImageBriefAndPreview, triggerPreviewRegen } from '../services/sessionPreviewService.js';
import { StorySummaryService } from '../services/storySummaryService.js';
import type { GameMode } from '../types.js';
import { sendRateLimitResponse } from './routeErrors.js';
import { booleanBodySchema, parseBody } from './routeValidation.js';

const createSessionBodySchema = z.object({
  worldDescription: z.string().optional(),
  difficulty: z.string().optional(),
  useLocalAI: z.boolean().optional(),
  gameMode: z.enum(['cinematic', 'balanced', 'fast']).optional(),
  dmPrep: z.string().optional(),
});

const patchSessionBodySchema = z.object({
  difficulty: z.string().optional(),
  gameMode: z.string().optional(),
  dmPrep: z.string().optional(),
  worldDescription: z.string().optional(),
});

export const createSessionRouter = () => {
  const router = Router();

  router.get('/sessions', asyncHandler(async (req, res) => {
    const sessions = await StateService.listSessions(req.namespaceId);
    res.json(sessions);
  }));

  router.delete('/session/:id', asyncHandler(async (req, res) => {
    const sessionId = req.params.id as string;
    const namespaceId = StateService.getSessionNamespaceId(sessionId) ?? req.namespaceId;
    await StateService.deleteSession(sessionId);
    broadcastSessionChanged(namespaceId, sessionId, 'deleted');
    res.json({ success: true });
  }));

  router.post('/session/create', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, createSessionBodySchema);
    if (!body) {
      return;
    }
    const { worldDescription, difficulty, useLocalAI, gameMode, dmPrep } = body;
    try {
      const limits = StateService.getNamespaceLimits(req.namespaceId);
      if (limits.maxSessions !== null) {
        const count = StateService.countSessionsInNamespace(req.namespaceId);
        if (count >= limits.maxSessions) {
          res.status(403).json({ error: 'session_limit', message: `This adventure group has reached its limit of ${limits.maxSessions} session(s). Ask the DM to remove old sessions.` });
          return;
        }
      }
      const savingsMode = !SettingsService.get().imagesEnabled;
      const session = await StateService.createSession(worldDescription, difficulty, !!useLocalAI, savingsMode, req.namespaceId, gameMode, dmPrep || undefined);
      broadcastSessionChanged(req.namespaceId, session.id, 'created');
      if (dmPrep) {
        refreshDmPrepImageBriefAndPreview(session.id, dmPrep, session.useLocalAI, req.namespaceId);
      } else {
        StorySummaryService.generateCampaignBrief(session.id, worldDescription, !!useLocalAI, session.displayName, difficulty, gameMode).then(brief => {
          if (brief) {
            triggerPreviewRegen(session.id, session.useLocalAI, req.namespaceId);
          }
        }).catch(err => {
          console.warn('[Campaign] Brief generation failed silently:', err);
        });
        triggerPreviewRegen(session.id, session.useLocalAI, req.namespaceId);
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
    const session = await StateService.getSession(req.params.id as string);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  }));

  router.patch('/session/:id', asyncHandler(async (req, res) => {
    const session = await StateService.getSession(req.params.id as string);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const body = parseBody(req, res, patchSessionBodySchema);
    if (!body) {
      return;
    }
    const { difficulty, gameMode, dmPrep, worldDescription } = body;
    const patch: { difficulty?: string; gameMode?: string; dmPrep?: string | null; worldDescription?: string | null } = {};
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
    await StateService.patchSession(req.params.id as string, patch);
    broadcastSessionChanged(req.namespaceId, req.params.id as string, 'updated');
    if (dmPrep !== undefined) {
      refreshDmPrepImageBriefAndPreview(req.params.id as string, dmPrep || null, session.useLocalAI, req.namespaceId);
    } else {
      triggerPreviewRegen(req.params.id as string, session.useLocalAI, req.namespaceId);
    }
    res.json({
      id: session.id,
      difficulty: patch.difficulty ?? session.difficulty,
      gameMode: patch.gameMode ?? session.gameMode,
      dmPrep: patch.dmPrep !== undefined ? patch.dmPrep : session.dmPrep,
      worldDescription: patch.worldDescription !== undefined ? (patch.worldDescription ?? undefined) : session.worldDescription,
    });
  }));

  router.post('/session/:id/preview-image', asyncHandler(async (req, res) => {
    const session = await StateService.getSession(req.params.id as string);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.savingsMode) {
      res.json({ previewImageUrl: null });
      return;
    }
    const result = await ImageService.generateSessionPreview(session, session.useLocalAI);
    if (result) {
      StateService.updateSessionPreviewImage(session.id, result.url);
      broadcastUpdate(session.id, 'preview_image_available', { previewImageUrl: result.url });
      broadcastSessionListUpdate(req.namespaceId, 'preview_image_available', { sessionId: session.id, previewImageUrl: result.url });
    }
    res.json({ previewImageUrl: result?.url ?? null });
  }));

  router.post('/session/:id/regenerate-dm-prep', asyncHandler(async (req, res) => {
    const session = await StateService.getSession(req.params.id as string);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const brief = await StorySummaryService.generateCampaignBrief(session.id, session.worldDescription, session.useLocalAI, session.displayName, session.difficulty, session.gameMode);
    if (!brief) {
      res.status(500).json({ error: 'Failed to generate campaign brief' });
      return;
    }
    res.json({ dmPrep: brief });
  }));

  router.post('/session/:id/start', asyncHandler(async (req, res) => {
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
      initialTurn = await AiDmService.generateTurnResult({ ...session, characterId: '', actionAttempt: "Adventure begins!", actionResult: { success: true, roll: 20, statUsed: 'none' } }, session.useLocalAI);
    } catch (error: unknown) {
      if (sendRateLimitResponse(res, error)) {
        return;
      }
      throw error;
    }
    initialTurn.id = await StateService.addTurnResult(sessionId, initialTurn, null);
    broadcastUpdate(sessionId, 'turn_complete', { session, turnResult: initialTurn });
    res.json({ success: true });

    if (!session.savingsMode) {
      void ImageService.generateImage(initialTurn.imagePrompt || 'A fantasy realm map', sessionId, session.turn, session.useLocalAI).then(async result => {
        if (result) {
          await StateService.updateLatestTurnImage(sessionId, result.url, result.storageKey, result.storageProvider);
          broadcastUpdate(sessionId, 'image_ready', { imageUrl: result.url });
        }
      }).catch(err => console.error('[Start] Background image generation failed:', err));
    }
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

  router.post('/session/:id/use-local-ai', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, booleanBodySchema);
    if (!body) {
      return;
    }
    const { enabled } = body;
    await StateService.setUseLocalAI(req.params.id as string, enabled);
    res.json({ useLocalAI: enabled });
  }));

  return router;
};
