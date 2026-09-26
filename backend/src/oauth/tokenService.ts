import crypto from 'crypto';
import { isMcpOAuthEnabled } from '../config/env.js';
import { withTransaction } from '../persistence/transaction.js';
import { oauthAuthorizationRepository } from '../repositories/oauthAuthorizationRepository.js';
import { oauthClientRepository } from '../repositories/oauthClientRepository.js';
import { oauthGrantRepository, type OAuthGrantRow } from '../repositories/oauthGrantRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { isMcpEligible } from '../services/accessTokenService.js';
import type { AccessTokenScope } from '../types.js';
import { parseScopeParam } from './authorizationService.js';
import { digestSecret, newSecret, verifyPkce } from './secrets.js';
import { resolveResource } from './urls.js';

// Token endpoint logic for MCP OAuth: authorization code exchange, refresh rotation,
// and revocation (RFC 6749, 7636, 7009, 8707).
//
// Single-use credentials (codes, refresh tokens) are consumed with one conditional
// update inside the same transaction that issues the next credentials, so two
// concurrent redemptions cannot both succeed. When a replay is detected, the grant is
// revoked in its own committed transaction before the error is returned, so the
// revocation is never rolled back with the failing request.

export const ACCESS_TOKEN_PREFIX = 'dndoat_';
export const REFRESH_TOKEN_PREFIX = 'dndort_';
export const ACCESS_TOKEN_LIFETIME_MS = 15 * 60 * 1000;
export const GRANT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_ENDED_GRANTS_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export type OAuthTokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export class OAuthTokenError extends Error {
  constructor(readonly status: number, readonly error: string, readonly description: string) {
    super(description);
  }
}

const invalidGrant = (description: string) => new OAuthTokenError(400, 'invalid_grant', description);

// Revokes in a transaction of its own, committed before the caller throws.
const revokeGrantNow = (grantId: string | null, now: number, reason: string): void => {
  if (grantId && withTransaction(() => oauthGrantRepository.revokeGrant(grantId, now))) {
    console.warn(`[OAuth] Grant ${grantId} revoked: ${reason}`);
  }
};

const stillAllowed = (grant: Pick<OAuthGrantRow, 'user_id' | 'namespace_id'>, now: number): boolean =>
  !!userRepository.getUserById(grant.user_id)
  && userRepository.isNamespaceMember(grant.user_id, grant.namespace_id)
  && isMcpEligible(grant.user_id, grant.namespace_id, now);

const issuePair = (grant: Pick<OAuthGrantRow, 'id' | 'expires_at'>, scopes: string, now: number): OAuthTokenResponse => {
  const accessToken = newSecret(ACCESS_TOKEN_PREFIX);
  const refreshToken = newSecret(REFRESH_TOKEN_PREFIX);
  const accessExpiresAt = Math.min(now + ACCESS_TOKEN_LIFETIME_MS, grant.expires_at);
  oauthGrantRepository.insertToken({ digest: digestSecret(accessToken), grant_id: grant.id, kind: 'access', scopes, created_at: now, expires_at: accessExpiresAt });
  oauthGrantRepository.insertToken({ digest: digestSecret(refreshToken), grant_id: grant.id, kind: 'refresh', scopes, created_at: now, expires_at: grant.expires_at });
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.max(1, Math.floor((accessExpiresAt - now) / 1000)),
    refresh_token: refreshToken,
    scope: scopes,
  };
};

type ResultOrReplay = { ok: true; tokens: OAuthTokenResponse } | { ok: false; replayOf: string | null };

export const oauthTokenService = {
  exchangeCode(input: { clientId: string; code: string | undefined; redirectUri: string | undefined; codeVerifier: string | undefined; resource: string | undefined }, now: number = Date.now()): OAuthTokenResponse {
    if (!input.code) {
      throw new OAuthTokenError(400, 'invalid_request', 'code is required');
    }
    const digest = digestSecret(input.code);
    const code = oauthAuthorizationRepository.getCode(digest);
    if (!code) {
      throw invalidGrant('Unknown authorization code');
    }
    if (code.used_at !== null) {
      revokeGrantNow(code.grant_id, now, 'authorization code reused');
      throw invalidGrant('Authorization code already used');
    }
    if (code.expires_at <= now) {
      throw invalidGrant('Authorization code expired');
    }
    if (code.client_id !== input.clientId) {
      throw invalidGrant('Authorization code was issued to another client');
    }
    if (input.redirectUri !== undefined && input.redirectUri !== code.redirect_uri) {
      throw invalidGrant('redirect_uri does not match the authorization request');
    }
    if (resolveResource(input.resource) !== code.resource) {
      throw new OAuthTokenError(400, 'invalid_target', 'resource must be this MCP server');
    }
    if (!verifyPkce(input.codeVerifier, code.code_challenge)) {
      throw invalidGrant('PKCE verification failed');
    }
    if (!isMcpOAuthEnabled() || !stillAllowed(code, now)) {
      throw invalidGrant('Assistant access is no longer available for this realm');
    }

    const result = withTransaction((): ResultOrReplay => {
      if (!oauthAuthorizationRepository.consumeCode(digest, now)) {
        return { ok: false, replayOf: oauthAuthorizationRepository.getCode(digest)?.grant_id ?? null };
      }
      const grant = {
        id: `ogr_${crypto.randomBytes(12).toString('base64url')}`,
        user_id: code.user_id,
        namespace_id: code.namespace_id,
        client_id: code.client_id,
        scopes: code.scopes,
        resource: code.resource,
        created_at: now,
        expires_at: now + GRANT_LIFETIME_MS,
      };
      oauthGrantRepository.insertGrant(grant);
      oauthAuthorizationRepository.setCodeGrant(digest, grant.id);
      oauthClientRepository.touch(code.client_id, now);
      oauthGrantRepository.prune(now, now - PRUNE_ENDED_GRANTS_AFTER_MS);
      return { ok: true, tokens: issuePair(grant, code.scopes, now) };
    });
    if (!result.ok) {
      revokeGrantNow(result.replayOf, now, 'authorization code reused');
      throw invalidGrant('Authorization code already used');
    }
    console.log(`[OAuth] Grant created for user ${code.user_id} namespace ${code.namespace_id} client ${code.client_id}`);
    return result.tokens;
  },

  refresh(input: { clientId: string; refreshToken: string | undefined; scope: string | undefined; resource: string | undefined }, now: number = Date.now()): OAuthTokenResponse {
    if (!input.refreshToken) {
      throw new OAuthTokenError(400, 'invalid_request', 'refresh_token is required');
    }
    const digest = digestSecret(input.refreshToken);
    const token = oauthGrantRepository.getToken(digest);
    if (!token || token.kind !== 'refresh') {
      throw invalidGrant('Unknown refresh token');
    }
    const grant = oauthGrantRepository.getGrant(token.grant_id);
    if (!grant) {
      throw invalidGrant('Unknown refresh token');
    }
    if (token.used_at !== null) {
      revokeGrantNow(grant.id, now, 'refresh token reused');
      throw invalidGrant('Refresh token already used');
    }
    if (grant.client_id !== input.clientId) {
      revokeGrantNow(grant.id, now, 'refresh token presented by another client');
      throw invalidGrant('Refresh token was issued to another client');
    }
    if (grant.revoked_at !== null || grant.expires_at <= now || token.expires_at <= now) {
      throw invalidGrant('The connection has ended. Sign in again.');
    }
    if (resolveResource(input.resource) !== grant.resource) {
      throw new OAuthTokenError(400, 'invalid_target', 'resource must be this MCP server');
    }
    const grantScopes = grant.scopes.split(' ') as AccessTokenScope[];
    let scopes = grant.scopes;
    if (input.scope !== undefined && input.scope.trim() !== '') {
      const requested = parseScopeParam(input.scope);
      if (!requested || !requested.every(scope => grantScopes.includes(scope))) {
        throw new OAuthTokenError(400, 'invalid_scope', 'Requested scope is wider than what was approved');
      }
      scopes = requested.join(' ');
    }
    if (!stillAllowed(grant, now)) {
      revokeGrantNow(grant.id, now, 'assistant access or membership ended');
      throw invalidGrant('Assistant access is no longer available for this realm');
    }

    const result = withTransaction((): ResultOrReplay => {
      if (!oauthGrantRepository.consumeRefreshToken(digest, now)) {
        return { ok: false, replayOf: grant.id };
      }
      return { ok: true, tokens: issuePair(grant, scopes, now) };
    });
    if (!result.ok) {
      revokeGrantNow(result.replayOf, now, 'refresh token reused');
      throw invalidGrant('Refresh token already used');
    }
    return result.tokens;
  },

  // RFC 7009: revoking either token kind ends the whole grant. Unknown tokens, and
  // tokens of another client, are silently ignored.
  revoke(input: { token: string | undefined; clientId: string | undefined }, now: number = Date.now()): void {
    if (!input.token) {
      return;
    }
    const row = oauthGrantRepository.getToken(digestSecret(input.token));
    const grant = row ? oauthGrantRepository.getGrant(row.grant_id) : null;
    if (!grant || (input.clientId !== undefined && input.clientId !== grant.client_id)) {
      return;
    }
    if (oauthGrantRepository.revokeGrant(grant.id, now)) {
      console.log(`[OAuth] Grant ${grant.id} revoked by its client`);
    }
  },
};
