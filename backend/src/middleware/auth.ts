import { Request, Response, NextFunction } from 'express';
import { verifyJwt, JwtPayload } from '../services/authService.js';
import { isAuthEnabled } from '../config/env.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      namespaceId: string;
      userEmail: string | null;
      pendingPayload?: JwtPayload;
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

export function requirePendingNamespaceToken(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    res.status(404).json({ error: 'Auth not configured' });
    return;
  }
  const token = (req.cookies as Record<string, string>)?.jwt_pending;
  if (!token) {
    res.status(401).json({ error: 'Missing pending token' });
    return;
  }
  const payload = verifyJwt(token);
  if (!payload || payload.type !== 'pending-namespace') {
    res.status(401).json({ error: 'Invalid or expired pending token' });
    return;
  }
  req.pendingPayload = payload;
  next();
}

export function requirePendingInviteToken(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    res.status(404).json({ error: 'Auth not configured' });
    return;
  }
  const token = (req.cookies as Record<string, string>)?.jwt_pending_invite;
  if (!token) {
    res.status(401).json({ error: 'Missing invite token' });
    return;
  }
  const payload = verifyJwt(token);
  if (!payload || (payload.type !== 'pending-invite' && payload.type !== 'invite-requested')) {
    res.status(401).json({ error: 'Invalid or expired invite token' });
    return;
  }
  req.pendingPayload = payload;
  next();
}
