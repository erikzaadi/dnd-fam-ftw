import { Router } from 'express';
import { z } from 'zod';
import { getConfig } from '../config/env.js';
import { getUsageContext } from '../lib/usageContext.js';
import { limitRequestRepository } from '../repositories/limitRequestRepository.js';
import { toSqliteTimestamp } from '../repositories/usageRepository.js';
import { dispatchOutbox, enqueueLimitRequestNotice } from '../services/emailService.js';
import { parseBody } from './routeValidation.js';
import { StateService } from '../services/stateService.js';
import { KOFI_SUPPORTER_DAYS } from '../services/kofiWebhookService.js';
import { checkPictureBudget, getDailyUsage, getEffectiveLimits, nextUtcReset, tierLabel } from '../services/usageLimitService.js';
import type { LimitRequestErrorResponse, NamespaceUsageResponse } from '../types.js';

const limitRequestBodySchema = z.object({
  note: z.string().max(500).optional(),
});

const LIMIT_REQUESTS_PER_DAY = 3;

export const createNamespaceRouter = () => {
  const router = Router();

  router.get('/namespace/limits', (req, res) => {
    const limits = getEffectiveLimits(req.namespaceId);
    const sessionCount = StateService.countSessionsInNamespace(req.namespaceId);
    res.json({
      maxSessions: limits.maxSessions,
      maxTurns: limits.maxTurns,
      sessionCount,
    });
  });

  router.get('/namespace/usage', (req, res) => {
    const limits = getEffectiveLimits(req.namespaceId);
    const today = getDailyUsage(req.namespaceId);
    const body: NamespaceUsageResponse = {
      tier: limits.tier,
      tierLabel: tierLabel(limits.tier),
      tierExpiresAt: limits.tierExpiresAt !== null ? new Date(limits.tierExpiresAt).toISOString() : null,
      limits: {
        textCreditsPerDay: limits.textCreditsPerDay,
        picturesPerDay: limits.picturesPerDay,
        maxSessions: limits.maxSessions,
        maxTurns: limits.maxTurns,
      },
      today: { textCredits: today.textCredits, pictures: today.pictures },
      sessionCount: StateService.countSessionsInNamespace(req.namespaceId),
      resetsAt: nextUtcReset().toISOString(),
      picturesPaused: checkPictureBudget(req.namespaceId) !== null,
      supportUrl: getConfig().SUPPORT_URL,
      donationUpgradeDays: getConfig().KOFI_VERIFICATION_TOKEN ? KOFI_SUPPORTER_DAYS : null,
      limitRequest: null,
    };
    const open = limitRequestRepository.getOpen(req.namespaceId);
    if (open) {
      body.limitRequest = { status: 'pending', createdAt: open.created_at };
    }
    res.json(body);
  });

  // "Ask for more": one open request per group, a few per day, owner is emailed.
  router.post('/namespace/limit-request', (req, res) => {
    const body = parseBody(req, res, limitRequestBodySchema);
    if (!body) {
      return;
    }
    const refuse = (status: number, error: LimitRequestErrorResponse) => {
      res.status(status).json(error);
    };
    const limits = getEffectiveLimits(req.namespaceId);
    if (limits.tier === 'unlimited') {
      refuse(400, { error: 'not_needed', message: 'Your realm has no daily limits.' });
      return;
    }
    const since = toSqliteTimestamp(new Date(Date.now() - 24 * 60 * 60 * 1000));
    if (limitRequestRepository.countSince(req.namespaceId, since) >= LIMIT_REQUESTS_PER_DAY) {
      refuse(429, { error: 'too_many_requests', message: 'You have asked a few times today already. Try again tomorrow.' });
      return;
    }
    const note = body.note?.trim() || null;
    const id = limitRequestRepository.create(req.namespaceId, getUsageContext()?.userId ?? null, req.userEmail, note);
    if (id === null) {
      refuse(409, { error: 'already_requested', message: 'Your request is already with the realm keeper.' });
      return;
    }
    enqueueLimitRequestNotice({
      requestId: id,
      namespaceId: req.namespaceId,
      namespaceName: StateService.getNamespaceById(req.namespaceId)?.name ?? null,
      tier: limits.tier,
      email: req.userEmail,
      note,
      requestedAt: new Date(),
    });
    void dispatchOutbox();
    console.log(`[Usage] Limit request ${id} from namespace ${req.namespaceId}`);
    res.status(201).json({ ok: true });
  });

  return router;
};
