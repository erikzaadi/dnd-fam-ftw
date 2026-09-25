import type { NextFunction, Request, Response } from 'express';
import { checkTextBudget } from '../services/usageLimitService.js';

// POST routes that start paid AI work. Refused with 429 once the namespace's daily text
// budget is spent. Work already under way (and routes that only finish an adventure)
// is left to the provider-level backstop, so an in-flight turn can complete.
const PAID_ROUTES: RegExp[] = [
  /^\/session\/(quick-start|instant-start|create)$/,
  /^\/session\/[^/]+\/(action|ask|ideas|start|origin-story|suggest-stat|preview-action|preview-image|regenerate-dm-prep)$/,
  /^\/session\/[^/]+\/adventure\/(wrap-up|continue)$/,
  /^\/character\/(create|suggest-stats)$/,
];

export function requireTextBudget(req: Request, res: Response, next: NextFunction): void {
  const refusal = checkTextBudget(req.namespaceId);
  if (refusal) {
    res.status(429).json(refusal);
    return;
  }
  next();
}

export function usageAdmissionMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'POST' || !PAID_ROUTES.some(route => route.test(req.path))) {
    next();
    return;
  }
  requireTextBudget(req, res, next);
}
