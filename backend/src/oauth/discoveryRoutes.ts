import { Router } from 'express';
import type { Response } from 'express';
import { isMcpOAuthEnabled } from '../config/env.js';
import { ACCESS_TOKEN_SCOPE_VALUES } from '../types.js';
import { mcpResource, oauthEndpoint, oauthIssuer } from './urls.js';

const notFound = (res: Response) => {
  res.status(404).json({ error: 'not_found' });
};

// OAuth discovery for MCP clients: Protected Resource Metadata (RFC 9728) and
// Authorization Server Metadata (RFC 8414). While MCP_OAUTH_ENABLED is off every
// .well-known path is a plain 404, which tells clients there is no authorization
// server (instead of a cookie 401 that some clients read as "start an OAuth login").
export const createOAuthDiscoveryRouter = () => {
  const router = Router();

  const protectedResource = (_req: unknown, res: Response) => {
    if (!isMcpOAuthEnabled()) {
      notFound(res);
      return;
    }
    res.json({
      resource: mcpResource(),
      authorization_servers: [oauthIssuer()],
      scopes_supported: [...ACCESS_TOKEN_SCOPE_VALUES],
      bearer_methods_supported: ['header'],
      resource_name: 'DnD Fam FTW',
    });
  };
  router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], protectedResource);

  router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    if (!isMcpOAuthEnabled()) {
      notFound(res);
      return;
    }
    res.json({
      issuer: oauthIssuer(),
      authorization_endpoint: oauthEndpoint('authorize'),
      token_endpoint: oauthEndpoint('token'),
      registration_endpoint: oauthEndpoint('register'),
      revocation_endpoint: oauthEndpoint('revoke'),
      scopes_supported: [...ACCESS_TOKEN_SCOPE_VALUES],
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  // Everything else (OpenID configuration, path-suffixed variants we do not serve).
  router.get(['/.well-known/*path', '/mcp/.well-known/*path'], (_req, res) => {
    notFound(res);
  });

  return router;
};
