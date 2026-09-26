import { withTransaction } from '../persistence/transaction.js';
import { oauthAuthorizationRepository } from '../repositories/oauthAuthorizationRepository.js';
import { oauthClientRepository } from '../repositories/oauthClientRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { isMcpEligible, normalizeScopes } from '../services/accessTokenService.js';
import { ACCESS_TOKEN_SCOPE_VALUES, type AccessTokenScope, type OAuthConsentDetailsResponse } from '../types.js';
import { oauthClientService, toOAuthClient } from './clientService.js';
import { findRegisteredRedirectUri } from './redirectUris.js';
import { CHALLENGE_PATTERN, digestSecret, newSecret } from './secrets.js';
import { consentPageUrl, oauthIssuer, resolveResource } from './urls.js';

// Authorization code flow for MCP clients. /oauth/authorize validates the request and
// parks it as a pending request; the signed-in player approves or denies it on the
// website consent page, which turns it into a single-use code for /oauth/token.
//
// Every redirect back to the client goes through clientRedirect(), which always adds
// iss (RFC 9207) and the client's state, errors included. Nothing redirects before the
// client and its redirect URI are validated.

const REQUEST_LIFETIME_MS = 10 * 60 * 1000;
const CODE_LIFETIME_MS = 60 * 1000;
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_STATE_LENGTH = 1024;
export const DEFAULT_OAUTH_SCOPES: AccessTokenScope[] = ['adventures:read', 'adventures:play'];

export const clientRedirect = (redirectUri: string, params: Record<string, string | null | undefined>): string => {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries({ ...params, iss: oauthIssuer() })) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url.href;
};

// Space-separated scope string to known scopes; null when any scope is unknown.
export const parseScopeParam = (raw: string | undefined): AccessTokenScope[] | null => {
  if (!raw || !raw.trim()) {
    return DEFAULT_OAUTH_SCOPES;
  }
  const requested = raw.trim().split(/\s+/);
  if (!requested.every(scope => (ACCESS_TOKEN_SCOPE_VALUES as readonly string[]).includes(scope))) {
    return null;
  }
  return normalizeScopes(requested as AccessTokenScope[]);
};

export type AuthorizeOutcome =
  | { kind: 'page'; status: number; message: string }
  | { kind: 'redirect'; url: string };

const single = (value: unknown): string | undefined | null => {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' ? value : null;
};

export const oauthAuthorizationService = {
  // Handles GET /oauth/authorize. Returns an error page for problems that cannot be
  // reported to a validated redirect URI, otherwise a redirect.
  async startAuthorization(query: Record<string, unknown>, now: number = Date.now()): Promise<AuthorizeOutcome> {
    const params = Object.fromEntries(
      ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'scope', 'state', 'resource']
        .map(key => [key, single(query[key])]),
    ) as Record<string, string | undefined | null>;
    if (Object.values(params).some(value => value === null)) {
      return { kind: 'page', status: 400, message: 'The sign-in request repeats a parameter.' };
    }
    if (!params.client_id) {
      return { kind: 'page', status: 400, message: 'The sign-in request does not name an app.' };
    }
    const client = await oauthClientService.getClient(params.client_id, { now });
    if (!client) {
      return { kind: 'page', status: 400, message: 'This app is not known to the realm, or its details could not be checked.' };
    }
    const redirectUri = findRegisteredRedirectUri(params.redirect_uri ?? undefined, client.redirectUris);
    if (!redirectUri) {
      return { kind: 'page', status: 400, message: 'The app asked to return to an address it did not register.' };
    }

    // From here on, errors go back to the client.
    const state = params.state ?? null;
    const fail = (error: string, description: string): AuthorizeOutcome => ({ kind: 'redirect', url: clientRedirect(redirectUri, { error, error_description: description, state }) });
    if (state !== null && state.length > MAX_STATE_LENGTH) {
      return fail('invalid_request', 'state is too long');
    }
    if (params.response_type !== 'code') {
      return fail('unsupported_response_type', 'Only response_type=code is supported');
    }
    if (!params.code_challenge || !CHALLENGE_PATTERN.test(params.code_challenge) || params.code_challenge_method !== 'S256') {
      return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required');
    }
    const resource = resolveResource(params.resource);
    if (!resource) {
      return fail('invalid_target', 'resource must be this MCP server');
    }
    const scopes = parseScopeParam(params.scope ?? undefined);
    if (!scopes) {
      return fail('invalid_scope', `Supported scopes: ${ACCESS_TOKEN_SCOPE_VALUES.join(' ')}`);
    }

    try {
      oauthAuthorizationRepository.pruneExpired(now - PRUNE_AFTER_MS);
      const requestId = newSecret('');
      oauthAuthorizationRepository.insertRequest({
        digest: digestSecret(requestId),
        client_id: client.clientId,
        redirect_uri: redirectUri,
        state,
        code_challenge: params.code_challenge,
        scopes: scopes.join(' '),
        resource,
        created_at: now,
        expires_at: now + REQUEST_LIFETIME_MS,
      });
      return { kind: 'redirect', url: consentPageUrl(requestId) };
    } catch (err) {
      console.error('[OAuth] Could not start authorization:', err instanceof Error ? err.message : String(err));
      return fail('server_error', 'Something went wrong. Try again.');
    }
  },

  // What the consent page shows. Null when the request is unknown, used, or expired.
  getConsentDetails(requestId: string, user: { userId: string; email: string; currentNamespaceId: string }, now: number = Date.now()): OAuthConsentDetailsResponse | null {
    const request = oauthAuthorizationRepository.getOpenRequest(digestSecret(requestId), now);
    const clientRow = request ? oauthClientRepository.get(request.client_id) : null;
    if (!request || !clientRow) {
      return null;
    }
    const client = toOAuthClient(clientRow);
    return {
      client: {
        name: client.clientName,
        verifiedHost: client.verifiedHost,
        redirectHost: new URL(request.redirect_uri).host,
      },
      requestedScopes: request.scopes.split(' ') as AccessTokenScope[],
      realms: userRepository.getUserNamespaces(user.email).map(realm => ({
        id: realm.id,
        name: realm.name,
        eligible: isMcpEligible(user.userId, realm.id, now),
      })),
      currentNamespaceId: user.currentNamespaceId,
      expiresAt: new Date(request.expires_at).toISOString(),
    };
  },

  // The player's decision. Approval rechecks membership and eligibility for the chosen
  // realm at this moment, then consumes the request and issues a code in one
  // transaction. Denial consumes the request and tells the client access_denied.
  decide(
    requestId: string,
    user: { userId: string },
    decision: { approve: false } | { approve: true; namespaceId: string; scopes: readonly AccessTokenScope[] },
    now: number = Date.now(),
  ): { ok: true; redirectUrl: string } | { ok: false; status: number; error: 'not_found' | 'not_eligible' } {
    const digest = digestSecret(requestId);
    return withTransaction(() => {
      const request = oauthAuthorizationRepository.getOpenRequest(digest, now);
      if (!request) {
        return { ok: false as const, status: 404, error: 'not_found' as const };
      }
      if (!decision.approve) {
        if (!oauthAuthorizationRepository.consumeRequest(digest, now)) {
          return { ok: false as const, status: 404, error: 'not_found' as const };
        }
        return { ok: true as const, redirectUrl: clientRedirect(request.redirect_uri, { error: 'access_denied', error_description: 'The player said no', state: request.state }) };
      }
      if (!userRepository.isNamespaceMember(user.userId, decision.namespaceId) || !isMcpEligible(user.userId, decision.namespaceId, now)) {
        return { ok: false as const, status: 403, error: 'not_eligible' as const };
      }
      if (!oauthAuthorizationRepository.consumeRequest(digest, now)) {
        return { ok: false as const, status: 404, error: 'not_found' as const };
      }
      const code = newSecret('dndoac_');
      oauthAuthorizationRepository.insertCode({
        digest: digestSecret(code),
        client_id: request.client_id,
        redirect_uri: request.redirect_uri,
        code_challenge: request.code_challenge,
        resource: request.resource,
        user_id: user.userId,
        namespace_id: decision.namespaceId,
        scopes: normalizeScopes(decision.scopes).join(' '),
        created_at: now,
        expires_at: now + CODE_LIFETIME_MS,
      });
      return { ok: true as const, redirectUrl: clientRedirect(request.redirect_uri, { code, state: request.state }) };
    });
  },
};
