import { getConfig } from '../config/env.js';

// Everything here comes from configuration (MCP_PUBLIC_URL, FRONTEND_URL), never from
// the request Host. assertAuthConfig guarantees both are set while OAuth is on.

// Canonical MCP resource (RFC 8707 / RFC 9728), e.g. https://api.example.com/mcp.
export const mcpResource = (): string => new URL(getConfig().MCP_PUBLIC_URL!).href.replace(/\/$/, '');

// Authorization server issuer: the API origin, no trailing slash.
export const oauthIssuer = (): string => new URL(getConfig().MCP_PUBLIC_URL!).origin;

export const protectedResourceMetadataUrl = (): string => `${oauthIssuer()}/.well-known/oauth-protected-resource/mcp`;

export const oauthEndpoint = (name: 'authorize' | 'token' | 'register' | 'revoke'): string => `${oauthIssuer()}/oauth/${name}`;

// Website page where the signed-in player approves or denies a client.
export const consentPageUrl = (requestId: string): string => {
  const config = getConfig();
  return `${config.FRONTEND_URL}${config.APP_BASE_PATH}oauth/consent?request=${encodeURIComponent(requestId)}`;
};

// A request's resource (RFC 8707) is accepted when absent (bound to the canonical
// resource) or when it names this MCP server. Uppercase scheme and host are accepted.
export const resolveResource = (requested: string | undefined | null): string | null => {
  if (requested === undefined || requested === null || requested === '') {
    return mcpResource();
  }
  let parsed: URL;
  try {
    parsed = new URL(requested);
  } catch {
    return null;
  }
  if (parsed.hash) {
    return null;
  }
  return parsed.href.replace(/\/$/, '') === mcpResource() ? mcpResource() : null;
};
