import { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../services/authService.js';
import { isAuthEnabled } from '../config/env.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      namespaceId: string;
      userEmail: string | null;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    req.namespaceId = 'local';
    req.userEmail = null;
    next();
    return;
  }

  const token = (req.cookies as Record<string, string>)?.jwt;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = verifyJwt(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  req.namespaceId = payload.namespaceId;
  req.userEmail = payload.email;
  next();
}
