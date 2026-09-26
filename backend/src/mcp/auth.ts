import type { NextFunction, Request, Response } from 'express';
import { isMcpEnabled } from '../config/env.js';
import { runWithUsageContext } from '../lib/usageContext.js';
import { createUsageContext } from '../services/usageAttribution.js';
import { accessTokenService, type McpPrincipal } from '../services/accessTokenService.js';

// Per-grant request ceiling, independent of model cooperation. In memory: the backend
// is a single process, and a restart only resets the window.
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;
const requestCounts = new Map<string, { windowStart: number; count: number }>();

export const resetMcpRateLimits = (): void => {
  requestCounts.clear();
};

const takeRateSlot = (grantId: string, now: number): number | null => {
  const entry = requestCounts.get(grantId);
  if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
    requestCounts.set(grantId, { windowStart: now, count: 1 });
    return null;
  }
  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return Math.ceil((entry.windowStart + RATE_WINDOW_MS - now) / 1000);
  }
  entry.count++;
  return null;
};

const unauthorized = (res: Response, error: 'invalid_request' | 'invalid_token', description: string) => {
  res.setHeader('WWW-Authenticate', `Bearer realm="dnd-fam-ftw", error="${error}", error_description="${description}"`);
  res.status(401).json({ error, error_description: description });
};

export const getMcpPrincipal = (res: Response): McpPrincipal => {
  const principal = res.locals.mcpPrincipal as McpPrincipal | undefined;
  if (!principal) {
    throw new Error('MCP handler reached without an authenticated principal');
  }
  return principal;
};

// Bearer personal access tokens only. Website cookies are ignored here, and the
// endpoint does not exist unless MCP is enabled with auth on.
export function mcpAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isMcpEnabled()) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const header = req.get('authorization');
  const match = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  if (!match) {
    unauthorized(res, 'invalid_request', 'Send a personal access token as Authorization: Bearer <token>');
    return;
  }
  const now = Date.now();
  const principal = accessTokenService.authenticate(match[1], now);
  if (!principal) {
    unauthorized(res, 'invalid_token', 'The token is unknown, expired, or revoked');
    return;
  }
  const retryAfter = takeRateSlot(principal.grantId, now);
  if (retryAfter !== null) {
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'rate_limited', retryAfterSeconds: retryAfter });
    return;
  }
  res.locals.mcpPrincipal = principal;
  // Provider calls made by tools are attributed like website requests.
  runWithUsageContext(createUsageContext(principal.namespaceId, principal.userId), next);
}
