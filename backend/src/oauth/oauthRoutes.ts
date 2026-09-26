import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { isMcpOAuthEnabled } from '../config/env.js';
import { oauthClientService } from './clientService.js';

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

  return router;
};
