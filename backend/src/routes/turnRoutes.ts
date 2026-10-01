import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { turnHistoryRepository } from '../repositories/turnHistoryRepository.js';
import { isAcceptanceResult, submitTurnCommand } from '../services/turnCommand.js';
import { parseBody } from './routeValidation.js';
import { sendRateLimitResponse } from './routeErrors.js';
import { registerSessionIdParam } from '../middleware/sessionParam.js';
import { respondToAcceptance } from '../services/sessionOperationService.js';
import { operationRepository, toPublicOperation } from '../repositories/operationRepository.js';
import { toPublicTurn } from '../services/sessionProjection.js';
import { DIFFICULTY_VALUES, STAT_VALUES } from '../types.js';
import { readCoherentSnapshot } from '../services/sessionSnapshotService.js';
import { summarizeAdventure } from '../services/playerSummaryService.js';
import { requirePaidWork } from '../middleware/usageAdmission.js';

const MAX_ACTION_LENGTH = 600;

const actionBodySchema = z.object({
  action: z.string().trim().min(1).max(MAX_ACTION_LENGTH),
  statUsed: z.enum([...STAT_VALUES, 'none']),
  difficulty: z.enum(DIFFICULTY_VALUES).optional(),
  difficultyValue: z.number().int().min(1).max(30).nullish(),
  itemId: z.string().max(100).optional(),
  characterId: z.string().max(100).optional(),
  ownerCharId: z.string().max(100).optional(),
  targetCharacterId: z.string().max(100).optional(),
  targetCharId: z.string().max(100).optional(),
  actionType: z.enum(['use_item', 'give_item']).optional(),
  actionIntent: z.string().max(60).optional(),
  previewId: z.string().max(100).optional(),
  // Stable id of a suggestion from the latest turn; older ids are rejected as stale.
  choiceId: z.number().int().positive().optional(),
  // Client-generated idempotency key. Replaying it returns the original operation.
  requestId: z.string().min(1).max(100).optional(),
  // Revision the client acted on. Omitted by legacy clients.
  expectedRevision: z.number().int().min(0).optional(),
});

export const createTurnRouter = () => {
  const router = Router();
  registerSessionIdParam(router);

  router.get('/session/:id/summary', requirePaidWork('summary'), asyncHandler(async (req, res) => {
    const [history, session] = await Promise.all([
      turnHistoryRepository.getTurnHistory(req.params.id as string),
      sessionRepository.getSession(req.params.id as string),
    ]);
    try {
      res.json({ summary: await summarizeAdventure(session, history) });
    } catch (err: unknown) {
      if (!sendRateLimitResponse(res, err)) {
        throw err;
      }
    }
  }));

  router.post('/session/:id/action', requirePaidWork('website'), asyncHandler(async (req, res) => {
    const body = parseBody(req, res, actionBodySchema);
    if (!body) {
      return;
    }
    const sessionId = req.params.id as string;
    const { requestId, expectedRevision, ...request } = body;

    // The client receives turn data via turn_complete SSE and errors via turn_error SSE,
    // and can always recover the outcome from /snapshot or the operation endpoint.
    const result = await submitTurnCommand<never, never>({
      adventureId: sessionId,
      realmId: req.namespaceId,
      requestId,
      idempotencyPayload: request,
      expectedRevision,
      session: req.session!,
      prepareNewWork: () => ({ ok: true, request }),
      // The route's requirePaidWork middleware admits the request.
      admit: () => ({ ok: true }),
    });
    if (result.type === 'invalid') {
      res.status(result.rejection.status).json(result.rejection.body);
      return;
    }
    if (isAcceptanceResult(result)) {
      respondToAcceptance(res, result);
    }
  }));

  router.get('/session/:id/snapshot', asyncHandler(async (req, res) => {
    const snapshot = await readCoherentSnapshot(req.params.id as string);
    if (!snapshot) {
      res.status(503).json({ error: 'snapshot_unavailable', message: 'The session is changing quickly. Try again.' });
      return;
    }
    res.json(snapshot);
  }));

  router.get('/session/:id/operations/:operationId', asyncHandler(async (req, res) => {
    const operation = operationRepository.get(req.params.id as string, req.params.operationId as string);
    if (!operation) {
      res.status(404).json({ error: 'Operation not found' });
      return;
    }
    res.json(toPublicOperation(operation));
  }));

  router.get('/session/:id/history', asyncHandler(async (req, res) => {
    const history = await turnHistoryRepository.getTurnHistory(req.params.id as string);
    res.json(history.map(toPublicTurn));
  }));

  return router;
};
