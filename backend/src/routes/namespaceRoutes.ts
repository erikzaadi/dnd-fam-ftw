import { Router } from 'express';
import { StateService } from '../services/stateService.js';
import { checkPictureBudget, getDailyUsage, getEffectiveLimits, nextUtcReset, tierLabel } from '../services/usageLimitService.js';
import type { NamespaceUsageResponse } from '../types.js';

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
    };
    res.json(body);
  });

  return router;
};
