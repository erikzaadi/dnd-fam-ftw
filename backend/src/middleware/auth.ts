import { Request, Response, NextFunction } from 'express';
import { verifyJwt, JwtPayload } from '../services/authService.js';
import { isAuthEnabled } from '../config/env.js';
import { userRepository } from '../repositories/userRepository.js';
import { runWithUsageContext } from '../lib/usageContext.js';
import { setFullAuthCookie } from '../routes/authCookies.js';
import type { NamespaceAccessLostResponse, NamespaceChangedResponse } from '../types.js';

// Sliding session: an active player whose login has less than this left gets a fresh
// 30-day cookie, so only people who stop playing have to sign in again.
const REFRESH_WITHIN_SECONDS = 7 * 24 * 60 * 60;

// Browser API calls carry the namespace the page believes is active. Only a
// consistency check against another tab switching realms; the cookie decides access.
export const NAMESPACE_HEADER = 'x-namespace-id';

export interface FullIdentity {
  userId: string;
  email: string;
  // The namespace in the cookie. Not yet checked against current memberships.
  namespaceId: string;
  payload: JwtPayload;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      namespaceId: string;
      userEmail: string | null;
      pendingPayload?: JwtPayload;
      fullIdentity?: FullIdentity;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    req.namespaceId = 'local';
    req.userEmail = null;
    runWithUsageContext({ namespaceId: 'local', userId: null }, next);
    return;
  }

  const identity = resolveFullIdentity(req, res);
  if (!identity) {
    return;
  }

  // Cookie names are client-controlled. Only full sessions for a current member
  // authorize gameplay, even when a pending or revoked token has a valid signature.
  if (!isMember(identity)) {
    const body: NamespaceAccessLostResponse = { error: 'Invalid or expired session', code: 'namespace_access_lost' };
    res.status(401).json(body);
    return;
  }

  const expected = req.get(NAMESPACE_HEADER);
  if (expected !== undefined && expected !== identity.namespaceId) {
    const body: NamespaceChangedResponse = { error: 'namespace_changed' };
    res.status(409).json(body);
    return;
  }

  refreshFullCookie(res, identity);
  req.namespaceId = identity.namespaceId;
  req.userEmail = identity.email;
  // Provider calls made for this request (and background work it starts) are
  // attributed to this namespace and user.
  runWithUsageContext({ namespaceId: identity.namespaceId, userId: identity.userId }, next);
}

// A valid full sign-in whose namespace may no longer be a membership. Only for the
// routes that list memberships and switch namespace, so a user removed from their
// active realm can pick another one without signing in again. Gameplay routes use
// authMiddleware, which also requires current membership.
export function requireFullIdentity(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    res.status(404).json({ error: 'Auth not configured' });
    return;
  }
  const identity = resolveFullIdentity(req, res);
  if (!identity) {
    return;
  }
  req.fullIdentity = identity;
  req.userEmail = identity.email;
  next();
}

function resolveFullIdentity(req: Request, res: Response): FullIdentity | null {
  const token = (req.cookies as Record<string, string>)?.jwt;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const payload = verifyJwt(token);
  if (!payload || payload.type !== 'full'
    || typeof payload.email !== 'string' || !payload.email.trim()
    || typeof payload.namespaceId !== 'string' || !payload.namespaceId.trim()) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return null;
  }

  const user = resolveSessionUser(payload);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return null;
  }
  return { userId: user.id, email: user.email, namespaceId: payload.namespaceId, payload };
}

function isMember(identity: FullIdentity): boolean {
  return userRepository.getUserNamespaces(identity.email).some(namespace => namespace.id === identity.namespaceId);
}

function refreshFullCookie(res: Response, identity: FullIdentity): void {
  if (typeof identity.payload.exp === 'number' && identity.payload.exp - Date.now() / 1000 < REFRESH_WITHIN_SECONDS) {
    // Re-issued with userId, which also upgrades older email-only tokens.
    setFullAuthCookie(res, { email: identity.email, namespaceId: identity.namespaceId, type: 'full', userId: identity.userId }, {
      isProduction: process.env.NODE_ENV === 'production',
    });
  }
}

// New full tokens carry a userId, so a deleted account's cookie can never match a
// replacement account with the same email. Older email-only tokens stay valid until
// they expire, but only for an account that already existed when they were issued.
function resolveSessionUser(payload: JwtPayload): { id: string; email: string } | null {
  if (payload.userId !== undefined) {
    if (typeof payload.userId !== 'string' || !payload.userId) {
      return null;
    }
    const user = userRepository.getUserById(payload.userId);
    return user && user.email === payload.email ? user : null;
  }
  const user = userRepository.getUserByEmail(payload.email);
  if (!user) {
    return null;
  }
  const createdAt = parseSqliteTimestamp(userRepository.getUserCreatedAt(user.email));
  if (createdAt === null || typeof payload.iat !== 'number' || createdAt > payload.iat) {
    return null;
  }
  return user;
}

// SQLite CURRENT_TIMESTAMP is UTC 'YYYY-MM-DD HH:MM:SS'. Returns epoch seconds.
function parseSqliteTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
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
