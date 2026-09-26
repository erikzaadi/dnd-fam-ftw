import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpPrincipal } from '../services/accessTokenService.js';
import { StateService } from '../services/stateService.js';
import { setUsageSessionId } from '../lib/usageContext.js';
import type { AccessTokenScope, SessionState } from '../types.js';

export const toolError = (message: string, code?: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: code ? `${message} (${code})` : message }],
});

// Audit line per tool call: who, what, outcome, time. Never action text or secrets.
export const audit = (principal: McpPrincipal, tool: string, startedAt: number, outcome: string, sessionId?: string): void => {
  console.log(`[MCP] token=${principal.tokenId} user=${principal.userId} tool=${tool}${sessionId ? ` session=${sessionId}` : ''} outcome=${outcome} ${Date.now() - startedAt}ms`);
};

export const hasScope = (principal: McpPrincipal, scope: AccessTokenScope): boolean => principal.scopes.includes(scope);

// Tools act only inside the token's namespace. A session in another namespace looks
// exactly like a missing one. The model never supplies the namespace.
export const ownsAdventure = (principal: McpPrincipal, sessionId: string): boolean =>
  StateService.getSessionNamespaceId(sessionId) === principal.namespaceId;

export const loadOwnedSession = async (principal: McpPrincipal, sessionId: string): Promise<SessionState | null> => {
  if (!ownsAdventure(principal, sessionId)) {
    return null;
  }
  setUsageSessionId(sessionId);
  return (await StateService.getSession(sessionId)) ?? null;
};

export const NOT_FOUND_MESSAGE = 'Adventure not found. Call list_adventures to see the adventures in this realm.';

// Binds MCP previews and preview dedup to one token.
export const principalKey = (principal: McpPrincipal): string => `mcp:${principal.tokenId}`;
