import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { isMcpOAuthEnabled } from '../config/env.js';
import { oauthClientService } from './clientService.js';
import { oauthAuthorizationService } from './authorizationService.js';

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Shown instead of redirecting when the client or its redirect URI is not trusted.
const errorPage = (res: Response, status: number, message: string) => {
  res.status(status).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Sign-in problem</title></head>`
    + `<body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;color:#0f172a"><h1>Sign-in problem</h1><p>${escapeHtml(message)}</p>`
    + '<p>Go back to your assistant and try connecting again.</p></body></html>');
};

// The OAuth authorization server endpoints for MCP clients (/oauth/*). Mounted with
// the MCP router, before the website cookie middleware: these endpoints never read or
// set website cookies. Each endpoint checks MCP_OAUTH_ENABLED on every request.

const requireOAuth = (_req: Request, res: Response, next: NextFunction) => {
  if (!isMcpOAuthEnabled()) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  next();
};

const noStore = (res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
};

export const createOAuthRouter = () => {
  const router = Router();

  // Dynamic Client Registration (RFC 7591), public clients only.
  router.post('/oauth/register', requireOAuth, (req, res) => {
    noStore(res);
    const result = oauthClientService.registerDynamicClient(req.body, req.ip ?? 'unknown');
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, error_description: result.description });
      return;
    }
    console.log(`[OAuth] Registered client ${result.client.clientId} (${result.client.clientName ?? 'unnamed'})`);
    res.status(201).json({
      client_id: result.client.clientId,
      client_id_issued_at: Math.floor(result.issuedAt / 1000),
      client_name: result.client.clientName ?? undefined,
      client_uri: result.client.clientUri ?? undefined,
      redirect_uris: result.client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  // Authorization endpoint: validates the request, then sends the browser to the
  // website consent page. Our own handler, so every redirect carries iss.
  router.get('/oauth/authorize', requireOAuth, (req, res) => {
    noStore(res);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    void oauthAuthorizationService.startAuthorization(req.query).then(outcome => {
      if (outcome.kind === 'page') {
        errorPage(res, outcome.status, outcome.message);
        return;
      }
      res.redirect(302, outcome.url);
    }).catch((err: unknown) => {
      console.error('[OAuth] Authorize failed:', err instanceof Error ? err.message : String(err));
      errorPage(res, 500, 'Something went wrong on our side.');
    });
  });

  return router;
};
