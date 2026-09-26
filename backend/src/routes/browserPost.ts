import type { NextFunction, Request, Response } from 'express';
import { isAllowedOrigin } from '../config/env.js';

// Stricter than the general /auth/* Origin check, for browser-only endpoints that
// change which realm a cookie grants (namespace switch, invitation accept): the
// Origin header must be present and allowed, and the body must be JSON. A missing
// or "null" Origin is rejected. With SameSite=Lax cookies this is the CSRF defense.
export const requireBrowserJsonPost = (isProduction: boolean) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!isAllowedOrigin(req.get('origin'), isProduction)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    if (!req.is('application/json')) {
      res.status(415).json({ error: 'Expected application/json' });
      return;
    }
    next();
  };
