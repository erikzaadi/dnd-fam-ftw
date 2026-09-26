import express, { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { isMcpOAuthEnabled } from '../config/env.js';
import { oauthClientService } from './clientService.js';
import { oauthAuthorizationService } from './authorizationService.js';
import { OAuthTokenError, oauthTokenService } from './tokenService.js';

// Token and revocation requests are form-encoded (RFC 6749); JSON is accepted too.
const formBody = express.urlencoded({ extended: false, limit: '8kb' });

const field = (body: unknown, name: string): string | undefined => {
  const value = (body as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : undefined;
};

const tokenError = (res: Response, status: number, error: string, description: string) => {
  res.status(status).json({ error, error_description: description });
};

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

  // Token endpoint: authorization_code (PKCE) and refresh_token grants, public
  // clients identified by client_id.
  router.post('/oauth/token', requireOAuth, formBody, (req, res) => {
    noStore(res);
    const clientId = field(req.body, 'client_id');
    const grantType = field(req.body, 'grant_type');
    if (!clientId) {
      tokenError(res, 401, 'invalid_client', 'client_id is required');
      return;
    }
    void oauthClientService.getClient(clientId).then(client => {
      if (!client) {
        tokenError(res, 401, 'invalid_client', 'Unknown client');
        return;
      }
      if (grantType === 'authorization_code') {
        res.json(oauthTokenService.exchangeCode({
          clientId,
          code: field(req.body, 'code'),
          redirectUri: field(req.body, 'redirect_uri'),
          codeVerifier: field(req.body, 'code_verifier'),
          resource: field(req.body, 'resource'),
        }));
        return;
      }
      if (grantType === 'refresh_token') {
        res.json(oauthTokenService.refresh({
          clientId,
          refreshToken: field(req.body, 'refresh_token'),
          scope: field(req.body, 'scope'),
          resource: field(req.body, 'resource'),
        }));
        return;
      }
      tokenError(res, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token');
    }).catch((err: unknown) => {
      if (err instanceof OAuthTokenError) {
        tokenError(res, err.status, err.error, err.description);
        return;
      }
      console.error('[OAuth] Token request failed:', err instanceof Error ? err.message : String(err));
      tokenError(res, 500, 'server_error', 'Something went wrong');
    });
  });

  // Revocation (RFC 7009). Keeps working while MCP_OAUTH_ENABLED is off, so clients
  // and players can always end a connection. Always 200 for well-formed requests.
  router.post('/oauth/revoke', formBody, (req, res) => {
    noStore(res);
    try {
      oauthTokenService.revoke({ token: field(req.body, 'token'), clientId: field(req.body, 'client_id') });
    } catch (err) {
      console.error('[OAuth] Revocation failed:', err instanceof Error ? err.message : String(err));
    }
    res.status(200).end();
  });

  return router;
};
