import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';
import { StateService } from '../services/stateService.js';
import { executeTurnAction, validateTurnActionRequest } from '../services/turnService.js';
import { parseBody } from './routeValidation.js';
import { sendRateLimitResponse } from './routeErrors.js';
import { registerSessionIdParam } from '../middleware/sessionParam.js';
import { runBackground } from '../middleware/runBackground.js';
import { acceptSessionOperation, respondIfKnownRequest, respondToAcceptance, runSessionOperation } from '../services/sessionOperationService.js';
import { resolvePartyRecovery } from '../services/partyRecoveryService.js';
import { concludeAdventure } from '../services/adventureConclusionService.js';
import { operationRepository, toPublicOperation } from '../repositories/operationRepository.js';
import { toPublicSession, toPublicTurn } from '../services/sessionProjection.js';
import { DIFFICULTY_VALUES, STAT_VALUES, type SessionSnapshot } from '../types.js';

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

// Reads session, history and operation state until the revision is stable, so a
// reconnecting client never mixes a newer session with older history (or vice versa).
const readCoherentSnapshot = async (sessionId: string): Promise<SessionSnapshot | null> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = StateService.getRevision(sessionId);
    if (before === undefined) {
      return null;
    }
    const [session, history] = await Promise.all([
      StateService.getSession(sessionId),
      StateService.getTurnHistory(sessionId),
    ]);
    const activeOperation = toPublicOperation(operationRepository.getActive(sessionId));
    const latestOperation = toPublicOperation(operationRepository.getLatest(sessionId));
    if (!session) {
      return null;
    }
    if (StateService.getRevision(sessionId) === before) {
      return { revision: before, session: toPublicSession(session), history: history.map(toPublicTurn), activeOperation, latestOperation };
    }
  }
  return null;
};

export const createTurnRouter = () => {
  const router = Router();
  registerSessionIdParam(router);

  router.get('/session/:id/summary', asyncHandler(async (req, res) => {
    const [history, session] = await Promise.all([
      StateService.getTurnHistory(req.params.id as string),
      StateService.getSession(req.params.id as string),
    ]);
    const battlesLine = session?.pastEncounters?.length
      ? `\n\nBattles fought: ${session.pastEncounters.map(e => `${e.name} (${e.status})`).join(', ')}.`
      : '';

    const realmContext = [
      session?.displayName ? `Realm: ${session.displayName}` : '',
      session?.worldDescription ? `Description: ${session.worldDescription}` : '',
      session?.difficulty ? `Difficulty: ${session.difficulty}` : '',
      session?.gameMode ? `Mode: ${session.gameMode}` : '',
    ].filter(Boolean).join('. ');

    const formatChar = (c: { name: string; class: string; species: string; hp: number; status?: string }) => {
      const status = c.hp === 0 || c.status === 'downed' ? ' - downed' : '';
      return `${c.name} the ${c.class} (${c.species}${status})`;
    };
    const partyContext = session?.party.length
      ? `\n\nParty: ${session.party.map(formatChar).join('; ')}.`
      : '';

    const originContext = session?.originStory
      ? `\n\nOrigin: ${session.originStory}`
      : '';

    const narrationContext = history.length
      ? `\n\nAdventure so far:\n${history.map(h => h.narration).join(' ')}${battlesLine}`
      : '';

    const instruction = history.length
      ? '\n\nSummarize this adventure in 3 sentences for the players. Focus on main plot points, character moments, and current situation.'
      : '\n\nSummarize the realm and party premise in 2-3 sentences for the players. The adventure has not yet begun.';

    const prompt = `${realmContext}${partyContext}${originContext}${narrationContext}${instruction}`;
    const { client, model } = createChatClientForTier('narration');
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
      if (sendRateLimitResponse(res, err)) {
        return;
      }
      console.error('[Summary] Failed:', err);
      res.json({ summary: 'The adventure was too legendary to put into words.' });
    }
  }));

  router.post('/session/:id/action', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, actionBodySchema);
    if (!body) {
      return;
    }
    const sessionId = req.params.id as string;
    const { requestId, expectedRevision, ...request } = body;

    if (respondIfKnownRequest(res, { sessionId, namespaceId: req.namespaceId, kind: 'action', requestId, payload: request })) {
      return;
    }
    // Validate before acceptance so obvious rejections never occupy the session guard.
    const rejection = validateTurnActionRequest(req.session!, req.namespaceId, request);
    if (rejection) {
      res.status(rejection.status).json(rejection.body);
      return;
    }

    const operation = respondToAcceptance(res, acceptSessionOperation({
      sessionId,
      namespaceId: req.namespaceId,
      kind: 'action',
      requestId,
      expectedRevision,
      payload: request,
    }));
    if (!operation) {
      return;
    }

    // The client receives turn data via turn_complete SSE and errors via turn_error SSE,
    // and can always recover the outcome from /snapshot or the operation endpoint.
    runBackground(`action session=${sessionId} operation=${operation.id}`, () => runSessionOperation(operation, async () => {
      const result = await executeTurnAction(sessionId, req.namespaceId, request, { operationId: operation.id });
      if (!result.ok) {
        return {
          error: String(result.body.error ?? 'turn_failed'),
          message: String(result.body.message ?? result.body.error ?? 'Something went wrong. Please try again.'),
        };
      }
      if (result.pendingConclusion) {
        await concludeAdventure({
          sessionId,
          namespaceId: req.namespaceId,
          operationId: operation.id,
          resolution: result.pendingConclusion,
        });
      }
      if (result.pendingRecovery) {
        await resolvePartyRecovery({
          sessionId,
          namespaceId: req.namespaceId,
          operationId: operation.id,
          outcome: result.pendingRecovery,
          wipedState: result.body.session,
          revision: result.revision,
        });
      }
      result.queueSideEffects?.();
    }));
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
    const history = await StateService.getTurnHistory(req.params.id as string);
    res.json(history.map(toPublicTurn));
  }));

  return router;
};
