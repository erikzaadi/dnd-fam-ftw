import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { registerSessionIdParam } from '../middleware/sessionParam.js';
import { askDm } from '../services/askDmService.js';
import { parseBody } from './routeValidation.js';

const askBodySchema = z.object({
  question: z.string().trim().min(1).max(300),
  turnId: z.number().int().positive(),
  revision: z.number().int().min(0),
}).strict();

export const createAskRouter = () => {
  const router = Router();
  registerSessionIdParam(router);

  // "Ask the DM": a short answer about the current scene. Never advances the story.
  router.post('/session/:id/ask', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, askBodySchema);
    if (!body) {
      return;
    }
    const result = await askDm(req.params.id as string, body);
    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }
    res.json(result.payload);
  }));

  return router;
};
