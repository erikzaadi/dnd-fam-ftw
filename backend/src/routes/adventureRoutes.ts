import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { registerSessionIdParam } from '../middleware/sessionParam.js';
import { continueAdventureWorld, endAdventureHere, wrapUpAdventure } from '../services/adventureLifecycleCommands.js';
import { ADVENTURE_FORMAT_VALUES } from '../types.js';
import { parseBody } from './routeValidation.js';

const operationBodySchema = z.object({
  requestId: z.string().min(1).max(100).optional(),
  expectedRevision: z.number().int().min(0).optional(),
});

const continueBodySchema = operationBodySchema.extend({
  adventureFormat: z.enum(ADVENTURE_FORMAT_VALUES).default('one_evening'),
});

// Thin HTTP wrappers; the lifecycle rules live in adventureLifecycleCommands.ts and are
// shared with MCP manage_adventure.
export const createAdventureRouter = () => {
  const router = Router();
  registerSessionIdParam(router);

  router.post('/session/:id/adventure/wrap-up', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, operationBodySchema);
    if (!body) {
      return;
    }
    const result = wrapUpAdventure(req.session!, body.expectedRevision);
    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }
    res.json({ revision: result.revision, adventure: result.adventure });
  }));

  router.post('/session/:id/adventure/end', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, operationBodySchema);
    if (!body) {
      return;
    }
    const outcome = endAdventureHere({ session: req.session!, namespaceId: req.namespaceId, requestId: body.requestId, expectedRevision: body.expectedRevision });
    res.status(outcome.status).json(outcome.body);
  }));

  router.post('/session/:id/adventure/continue', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, continueBodySchema);
    if (!body) {
      return;
    }
    const outcome = continueAdventureWorld({
      session: req.session!,
      namespaceId: req.namespaceId,
      adventureFormat: body.adventureFormat,
      requestId: body.requestId,
      expectedRevision: body.expectedRevision,
    });
    res.status(outcome.status).json(outcome.body);
  }));

  return router;
};
