import crypto from 'crypto';
import { isMcpEnabled } from '../config/env.js';
import { createId } from '../lib/ids.js';
import { withTransaction } from '../persistence/transaction.js';
import { accessTokenRepository, type AccessTokenRow } from '../repositories/accessTokenRepository.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { ACCESS_TOKEN_SCOPE_VALUES, type AccessTokenScope, type AccessTokenSummary } from '../types.js';

// Personal access tokens for the MCP endpoint (invite-only pilot). The secret is
// 256 random bits, shown once; only its SHA-256 digest is stored. A token is valid
// only while it is unexpired, unrevoked, its user is in the MCP pilot, and the user is
// still a member of the token's namespace. Website cookies never work on /mcp and MCP
// tokens never work as website sessions.

export const TOKEN_PREFIX = 'dndmcp_';
export const MAX_ACTIVE_TOKENS_PER_USER = 5;
export const TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const PREFIX_DISPLAY_LENGTH = TOKEN_PREFIX.length + 6;

export type McpPrincipal = {
  tokenId: string;
  userId: string;
  email: string;
  namespaceId: string;
  scopes: AccessTokenScope[];
  expiresAt: number;
};

export type CreateTokenResult =
  | { ok: true; token: AccessTokenSummary; secret: string }
  | { ok: false; error: 'not_eligible' | 'not_member' | 'too_many_tokens' | 'not_found' };

const digestSecret = (secret: string): string => crypto.createHash('sha256').update(secret).digest('hex');

// Read is always granted: a token that cannot read state cannot play safely.
export const normalizeScopes = (requested: readonly AccessTokenScope[]): AccessTokenScope[] =>
  ACCESS_TOKEN_SCOPE_VALUES.filter(scope => scope === 'adventures:read' || requested.includes(scope));

const parseScopes = (raw: string): AccessTokenScope[] =>
  raw.split(' ').filter((scope): scope is AccessTokenScope => (ACCESS_TOKEN_SCOPE_VALUES as readonly string[]).includes(scope));

const toIso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export const toAccessTokenSummary = (row: AccessTokenRow): AccessTokenSummary => ({
  id: row.id,
  label: row.label,
  prefix: row.token_prefix,
  namespaceId: row.namespace_id,
  namespaceName: namespaceRepository.getNamespaceById(row.namespace_id)?.name ?? null,
  scopes: parseScopes(row.scopes),
  createdAt: new Date(row.created_at).toISOString(),
  expiresAt: new Date(row.expires_at).toISOString(),
  lastUsedAt: toIso(row.last_used_at),
  revokedAt: toIso(row.revoked_at),
});

export const isMcpEligible = (userId: string): boolean => isMcpEnabled() && userRepository.hasMcpAccess(userId);

const insertToken = (userId: string, namespaceId: string, label: string, scopes: AccessTokenScope[], now: number): { row: AccessTokenRow; secret: string } => {
  const secret = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const row: AccessTokenRow = {
    id: createId(),
    user_id: userId,
    namespace_id: namespaceId,
    label,
    token_prefix: secret.slice(0, PREFIX_DISPLAY_LENGTH),
    token_digest: digestSecret(secret),
    scopes: scopes.join(' '),
    created_at: now,
    expires_at: now + TOKEN_LIFETIME_MS,
    last_used_at: null,
    revoked_at: null,
  };
  accessTokenRepository.insert(row);
  return { row, secret };
};

export const accessTokenService = {
  list(userId: string): AccessTokenSummary[] {
    return accessTokenRepository.listForUser(userId).map(toAccessTokenSummary);
  },

  create(input: { userId: string; namespaceId: string; label: string; scopes: readonly AccessTokenScope[]; now?: number }): CreateTokenResult {
    const now = input.now ?? Date.now();
    if (!isMcpEligible(input.userId)) {
      return { ok: false, error: 'not_eligible' };
    }
    if (!userRepository.isNamespaceMember(input.userId, input.namespaceId)) {
      return { ok: false, error: 'not_member' };
    }
    return withTransaction((): CreateTokenResult => {
      if (accessTokenRepository.countActiveForUser(input.userId, now) >= MAX_ACTIVE_TOKENS_PER_USER) {
        return { ok: false, error: 'too_many_tokens' };
      }
      const { row, secret } = insertToken(input.userId, input.namespaceId, input.label, normalizeScopes(input.scopes), now);
      return { ok: true, token: toAccessTokenSummary(row), secret };
    });
  },

  // Issues a replacement with the same label, namespace, and scopes, then revokes the old one.
  rotate(userId: string, tokenId: string, now: number = Date.now()): CreateTokenResult {
    if (!isMcpEligible(userId)) {
      return { ok: false, error: 'not_eligible' };
    }
    return withTransaction((): CreateTokenResult => {
      const old = accessTokenRepository.getForUser(userId, tokenId);
      if (!old || old.revoked_at !== null || old.expires_at <= now) {
        return { ok: false, error: 'not_found' };
      }
      if (!userRepository.isNamespaceMember(userId, old.namespace_id)) {
        return { ok: false, error: 'not_member' };
      }
      const { row, secret } = insertToken(userId, old.namespace_id, old.label, parseScopes(old.scopes), now);
      accessTokenRepository.revoke(userId, old.id, now);
      return { ok: true, token: toAccessTokenSummary(row), secret };
    });
  },

  revoke(userId: string, tokenId: string, now: number = Date.now()): boolean {
    return accessTokenRepository.revoke(userId, tokenId, now);
  },

  // Resolves an Authorization bearer value to a principal, rechecking every grant
  // condition on each call. Returns null for anything that is not a live token.
  authenticate(secret: string, now: number = Date.now()): McpPrincipal | null {
    if (!isMcpEnabled() || !secret.startsWith(TOKEN_PREFIX) || secret.length > 128) {
      return null;
    }
    const row = accessTokenRepository.getByDigest(digestSecret(secret));
    if (!row || row.revoked_at !== null || row.expires_at <= now) {
      return null;
    }
    const user = userRepository.getUserById(row.user_id);
    if (!user || !userRepository.hasMcpAccess(user.id) || !userRepository.isNamespaceMember(user.id, row.namespace_id)) {
      return null;
    }
    accessTokenRepository.touch(row.id, now);
    return {
      tokenId: row.id,
      userId: user.id,
      email: user.email,
      namespaceId: row.namespace_id,
      scopes: parseScopes(row.scopes),
      expiresAt: row.expires_at,
    };
  },
};
