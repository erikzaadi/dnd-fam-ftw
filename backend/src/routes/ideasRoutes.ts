import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { registerSessionIdParam } from '../middleware/sessionParam.js';
import { requestIdeas } from '../services/ideasService.js';
import { parseBody } from './routeValidation.js';

const ideasBodySchema = z.object({
  turnId: z.number().int().positive(),
  revision: z.number().int().min(0),
  reason: z.enum(['onboarding_auto']).optional(),
  retry: z.boolean().optional(),
}).strict();

export const createIdeasRouter = () => {
  const router = Router();
  registerSessionIdParam(router);

  // Suggested actions for the current turn, on request. Never advances the story.
  router.post('/session/:id/ideas', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, ideasBodySchema);
    if (!body) {
      return;
    }
    const result = await requestIdeas(req.params.id as string, body);
    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }
    res.json(result.payload);
  }));

  return router;
};
