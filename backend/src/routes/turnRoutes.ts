import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';
import { StateService } from '../services/stateService.js';
import { executeTurnAction } from '../services/turnService.js';
import { parseBody } from './routeValidation.js';
import { sendRateLimitResponse } from './routeErrors.js';
import { registerSessionIdParam } from '../middleware/sessionParam.js';
import { broadcastUpdate } from '../realtime/sessionEvents.js';
import { runBackground } from '../middleware/runBackground.js';

const actionBodySchema = z.object({
  action: z.string(),
  statUsed: z.string(),
  difficulty: z.string().optional(),
  difficultyValue: z.number().nullish(),
  itemId: z.string().optional(),
  characterId: z.string().optional(),
  ownerCharId: z.string().optional(),
  targetCharacterId: z.string().optional(),
  targetCharId: z.string().optional(),
  actionType: z.enum(['use_item', 'give_item']).optional(),
  actionIntent: z.string().optional(),
});

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

    // Respond immediately; the LLM call and all state updates happen in the background.
    // The client receives turn data via turn_complete SSE and errors via turn_error SSE.
    res.status(202).json({ queued: true });

    runBackground(`action session=${sessionId} action="${body.action}"`, async () => {
      let result;
      try {
        result = await executeTurnAction(sessionId, req.namespaceId, body);
      } catch (error: unknown) {
        const isRateLimit = (error as { status?: number })?.status === 429;
        broadcastUpdate(sessionId, 'turn_error', {
          error: isRateLimit ? 'rate_limit' : 'turn_failed',
          message: isRateLimit
            ? 'The AI is overwhelmed with requests. Wait a moment and try again.'
            : 'Something went wrong. Please try again.',
        });
        return;
      }
      if (!result.ok) {
        broadcastUpdate(sessionId, 'turn_error', result.body);
        return;
      }
      result.queueSideEffects?.();
    });
  }));

  router.get('/session/:id/history', asyncHandler(async (req, res) => {
    const history = await StateService.getTurnHistory(req.params.id as string);
    res.json(history);
  }));

  return router;
};
