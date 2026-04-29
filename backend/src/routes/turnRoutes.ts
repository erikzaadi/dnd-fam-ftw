import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { createChatClient } from '../providers/ai/AiProviderFactory.js';
import { StateService } from '../services/stateService.js';
import { executeTurnAction } from '../services/turnService.js';
import { sendRateLimitResponse } from './routeErrors.js';
import { parseBody } from './routeValidation.js';

const actionBodySchema = z.object({
  action: z.string(),
  statUsed: z.string(),
  difficulty: z.string().optional(),
  difficultyValue: z.number().optional(),
  itemId: z.string().optional(),
  characterId: z.string().optional(),
  ownerCharId: z.string().optional(),
  targetCharacterId: z.string().optional(),
  targetCharId: z.string().optional(),
  actionType: z.enum(['use_item', 'give_item']).optional(),
});

export const createTurnRouter = () => {
  const router = Router();

  router.get('/session/:id/summary', asyncHandler(async (req, res) => {
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

    let result;
    try {
      result = await executeTurnAction(sessionId, req.namespaceId, body);
    } catch (error: unknown) {
      if (sendRateLimitResponse(res, error)) {
        return;
      }
      throw error;
    }

    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }
    res.json(result.body);
    result.queueSideEffects?.();
  }));

  router.get('/session/:id/history', asyncHandler(async (req, res) => {
    const history = await StateService.getTurnHistory(req.params.id as string);
    res.json(history);
  }));

  return router;
};
