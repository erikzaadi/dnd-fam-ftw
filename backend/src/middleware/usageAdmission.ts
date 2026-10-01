import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getUsageContext } from '../lib/usageContext.js';
import { admitPaidWork, paidWorkRefusalStatus, type PaidWorkKind } from '../services/paidWorkAdmission.js';

// POST routes that start paid AI work. Refused once the namespace's daily text budget
// is spent. Work already under way (and routes that only finish an adventure) is left
// to the provider-level backstop, so an in-flight turn can complete.
const PAID_ROUTES: RegExp[] = [
  /^\/session\/(quick-start|instant-start|create)$/,
  /^\/session\/[^/]+\/(action|ask|ideas|start|origin-story|suggest-stat|preview-action|preview-image|regenerate-dm-prep)$/,
  /^\/session\/[^/]+\/adventure\/(wrap-up|continue)$/,
  /^\/character\/(create|suggest-stats)$/,
];

// HTTP adapter for paid-work admission (services/paidWorkAdmission.ts).
export const requirePaidWork = (kind: PaidWorkKind): RequestHandler => (req: Request, res: Response, next: NextFunction): void => {
  const admission = admitPaidWork(kind, { namespaceId: req.namespaceId, attribution: getUsageContext()?.attribution });
  if (!admission.ok) {
    res.status(paidWorkRefusalStatus(admission.refusal)).json(admission.refusal);
    return;
  }
  next();
};

export const requireTextBudget = requirePaidWork('tts');

const requireWebsitePaidWork = requirePaidWork('website');

export function usageAdmissionMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'POST' || !PAID_ROUTES.some(route => route.test(req.path))) {
    next();
    return;
  }
  requireWebsitePaidWork(req, res, next);
}
