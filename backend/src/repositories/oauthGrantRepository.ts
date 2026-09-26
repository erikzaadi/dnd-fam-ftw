import { getDb } from '../persistence/database.js';

export type OAuthGrantRow = {
  id: string;
  user_id: string;
  namespace_id: string;
  client_id: string;
  scopes: string;
  resource: string;
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

export type OAuthTokenKind = 'access' | 'refresh';

export type OAuthTokenRow = {
  digest: string;
  grant_id: string;
  kind: OAuthTokenKind;
  scopes: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
};

export type OAuthGrantListItem = OAuthGrantRow & {
  client_name: string | null;
  client_kind: string | null;
  namespace_name: string | null;
  email: string | null;
};

const LIST_SELECT = `
  SELECT g.*, c.client_name AS client_name, c.kind AS client_kind, n.name AS namespace_name, u.email AS email
  FROM oauth_grants g
  LEFT JOIN oauth_clients c ON c.client_id = g.client_id
  LEFT JOIN namespaces n ON n.id = g.namespace_id
  LEFT JOIN users u ON u.id = g.user_id
`;

export const oauthGrantRepository = {
  insertGrant(row: Omit<OAuthGrantRow, 'last_used_at' | 'revoked_at'>): void {
    getDb().prepare(`
      INSERT INTO oauth_grants (id, user_id, namespace_id, client_id, scopes, resource, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.user_id, row.namespace_id, row.client_id, row.scopes, row.resource, row.created_at, row.expires_at);
  },

  getGrant(id: string): OAuthGrantRow | null {
    return (getDb().prepare('SELECT * FROM oauth_grants WHERE id = ?').get(id) as OAuthGrantRow | undefined) ?? null;
  },

  // Idempotent; true when this call revoked it.
  revokeGrant(id: string, now: number): boolean {
    return getDb().prepare('UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, id).changes > 0;
  },

  revokeGrantForUser(userId: string, id: string, now: number): boolean {
    return getDb().prepare('UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').run(now, id, userId).changes > 0;
  },

  revokeAllForUser(userId: string, now: number): number {
    return getDb().prepare('UPDATE oauth_grants SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, userId).changes;
  },

  // At most once a minute per grant, so busy play does not write on every request.
  touchGrant(id: string, now: number): void {
    getDb().prepare('UPDATE oauth_grants SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)').run(now, id, now - 60_000);
  },

  listForUser(userId: string): OAuthGrantListItem[] {
    return getDb().prepare(`${LIST_SELECT} WHERE g.user_id = ? ORDER BY g.created_at DESC LIMIT 100`).all(userId) as OAuthGrantListItem[];
  },

  listAll(): OAuthGrantListItem[] {
    return getDb().prepare(`${LIST_SELECT} ORDER BY g.created_at DESC LIMIT 500`).all() as OAuthGrantListItem[];
  },

  insertToken(row: Omit<OAuthTokenRow, 'used_at'>): void {
    getDb().prepare(`
      INSERT INTO oauth_tokens (digest, grant_id, kind, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)
    `).run(row.digest, row.grant_id, row.kind, row.scopes, row.created_at, row.expires_at);
  },

  getToken(digest: string): OAuthTokenRow | null {
    return (getDb().prepare('SELECT * FROM oauth_tokens WHERE digest = ?').get(digest) as OAuthTokenRow | undefined) ?? null;
  },

  // Single use: true only for the one caller that flips used_at.
  consumeRefreshToken(digest: string, now: number): boolean {
    return getDb().prepare("UPDATE oauth_tokens SET used_at = ? WHERE digest = ? AND kind = 'refresh' AND used_at IS NULL AND expires_at > ?")
      .run(now, digest, now).changes === 1;
  },

  // Expired access tokens, and every token of grants that ended long ago.
  prune(now: number, grantsEndedBefore: number): void {
    const db = getDb();
    db.prepare("DELETE FROM oauth_tokens WHERE kind = 'access' AND expires_at < ?").run(now);
    db.prepare(`DELETE FROM oauth_tokens WHERE grant_id IN (
      SELECT id FROM oauth_grants WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?))`).run(grantsEndedBefore, grantsEndedBefore);
  },
};
