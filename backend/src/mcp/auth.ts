import type { NextFunction, Request, Response } from 'express';
import { isMcpEnabled, isMcpOAuthEnabled } from '../config/env.js';
import { protectedResourceMetadataUrl } from '../oauth/urls.js';
import { ACCESS_TOKEN_PREFIX, oauthTokenService } from '../oauth/tokenService.js';
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

// Scopes a client should ask for on first sign-in; more can be ticked on the consent page.
const CHALLENGE_SCOPES = 'adventures:read adventures:play';

// With OAuth on, the challenge points clients at Protected Resource Metadata (RFC 9728)
// so they can start sign-in. Without it the challenge stays a plain bearer error.
const unauthorized = (res: Response, error: 'invalid_request' | 'invalid_token', description: string) => {
  const discovery = isMcpOAuthEnabled() ? ` resource_metadata="${protectedResourceMetadataUrl()}", scope="${CHALLENGE_SCOPES}",` : '';
  res.setHeader('WWW-Authenticate', `Bearer realm="dnd-fam-ftw",${discovery} error="${error}", error_description="${description}"`);
  res.status(401).json({ error, error_description: description });
};

export const getMcpPrincipal = (res: Response): McpPrincipal => {
  const principal = res.locals.mcpPrincipal as McpPrincipal | undefined;
  if (!principal) {
    throw new Error('MCP handler reached without an authenticated principal');
  }
  return principal;
};

// Bearer tokens only: personal access tokens, or OAuth access tokens (dndoat_) while
// MCP_OAUTH_ENABLED is on. Website cookies are ignored here, and the endpoint does not
// exist unless MCP is enabled with auth on.
export function mcpAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isMcpEnabled()) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const header = req.get('authorization');
  const match = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  if (!match) {
    unauthorized(res, 'invalid_request', 'Send an access token as Authorization: Bearer <token>');
    return;
  }
  const now = Date.now();
  const secret = match[1];
  const principal = secret.startsWith(ACCESS_TOKEN_PREFIX)
    ? oauthTokenService.authenticate(secret, now)
    : accessTokenService.authenticate(secret, now);
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
