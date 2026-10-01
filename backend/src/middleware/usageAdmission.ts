import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getUsageContext } from '../lib/usageContext.js';
import { admitPaidWork, paidWorkRefusalStatus, type PaidWorkKind } from '../services/paidWorkAdmission.js';

// HTTP adapter for paid-work admission (services/paidWorkAdmission.ts). Put it on every
// route that starts paid AI work, before the handler; routes/paidRoutes.test.ts lists
// them. Work already under way (and routes that only finish an adventure) is left to
// the provider-level backstop, so an in-flight turn can complete.
export const requirePaidWork = (kind: PaidWorkKind): RequestHandler => (req: Request, res: Response, next: NextFunction): void => {
  const admission = admitPaidWork(kind, { namespaceId: req.namespaceId, attribution: getUsageContext()?.attribution });
  if (!admission.ok) {
    res.status(paidWorkRefusalStatus(admission.refusal)).json(admission.refusal);
    return;
  }
  next();
};

export const requireTextBudget = requirePaidWork('tts');
