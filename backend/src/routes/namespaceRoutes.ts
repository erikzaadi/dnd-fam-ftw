import { Router } from 'express';
import { StateService } from '../services/stateService.js';
import { getEffectiveLimits } from '../services/usageLimitService.js';

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

  return router;
};
