import { getDb } from '../persistence/database.js';

// Personal access tokens for the MCP endpoint. Times are epoch milliseconds.
export type AccessTokenRow = {
  id: string;
  user_id: string;
  namespace_id: string;
  label: string;
  token_prefix: string;
  token_digest: string;
  scopes: string;
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

export type NewAccessToken = Omit<AccessTokenRow, 'last_used_at' | 'revoked_at'>;

export const accessTokenRepository = {
  insert(token: NewAccessToken): void {
    getDb().prepare(`
      INSERT INTO access_tokens (id, user_id, namespace_id, label, token_prefix, token_digest, scopes, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(token.id, token.user_id, token.namespace_id, token.label, token.token_prefix, token.token_digest, token.scopes, token.created_at, token.expires_at);
  },

  getByDigest(digest: string): AccessTokenRow | null {
    return (getDb().prepare('SELECT * FROM access_tokens WHERE token_digest = ?').get(digest) as AccessTokenRow | undefined) ?? null;
  },

  getForUser(userId: string, id: string): AccessTokenRow | null {
    return (getDb().prepare('SELECT * FROM access_tokens WHERE id = ? AND user_id = ?').get(id, userId) as AccessTokenRow | undefined) ?? null;
  },

  // Newest first. Includes revoked and expired tokens so the page can show their history.
  listForUser(userId: string): AccessTokenRow[] {
    return getDb().prepare('SELECT * FROM access_tokens WHERE user_id = ? ORDER BY created_at DESC, id ASC').all(userId) as AccessTokenRow[];
  },

  countActiveForUser(userId: string, now: number): number {
    const row = getDb().prepare('SELECT COUNT(*) AS count FROM access_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?').get(userId, now) as { count: number };
    return row.count;
  },

  revoke(userId: string, id: string, now: number): boolean {
    const result = getDb().prepare('UPDATE access_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').run(now, id, userId);
    return result.changes > 0;
  },

  // Written at most once a minute per token, so every MCP request is not a DB write.
  touch(id: string, now: number): void {
    getDb().prepare('UPDATE access_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)').run(now, id, now - 60_000);
  },

  revokeAllForUser(userId: string, now: number): number {
    return getDb().prepare('UPDATE access_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, userId).changes;
  },
};
