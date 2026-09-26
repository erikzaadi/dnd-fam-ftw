import { getDb } from '../persistence/database.js';

export type OAuthAuthorizationRequestRow = {
  digest: string;
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
  scopes: string;
  resource: string;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
};

export type OAuthCodeRow = {
  digest: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  user_id: string;
  namespace_id: string;
  scopes: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  grant_id: string | null;
};

export const oauthAuthorizationRepository = {
  insertRequest(row: Omit<OAuthAuthorizationRequestRow, 'consumed_at'>): void {
    getDb().prepare(`
      INSERT INTO oauth_authorization_requests (digest, client_id, redirect_uri, state, code_challenge, scopes, resource, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.digest, row.client_id, row.redirect_uri, row.state, row.code_challenge, row.scopes, row.resource, row.created_at, row.expires_at);
  },

  // An open request: not consumed and not expired.
  getOpenRequest(digest: string, now: number): OAuthAuthorizationRequestRow | null {
    return (getDb().prepare('SELECT * FROM oauth_authorization_requests WHERE digest = ? AND consumed_at IS NULL AND expires_at > ?')
      .get(digest, now) as OAuthAuthorizationRequestRow | undefined) ?? null;
  },

  // Single use: true only for the one caller that flips consumed_at.
  consumeRequest(digest: string, now: number): boolean {
    return getDb().prepare('UPDATE oauth_authorization_requests SET consumed_at = ? WHERE digest = ? AND consumed_at IS NULL AND expires_at > ?')
      .run(now, digest, now).changes === 1;
  },

  insertCode(row: Omit<OAuthCodeRow, 'used_at' | 'grant_id'>): void {
    getDb().prepare(`
      INSERT INTO oauth_codes (digest, client_id, redirect_uri, code_challenge, resource, user_id, namespace_id, scopes, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.digest, row.client_id, row.redirect_uri, row.code_challenge, row.resource, row.user_id, row.namespace_id, row.scopes, row.created_at, row.expires_at);
  },

  getCode(digest: string): OAuthCodeRow | null {
    return (getDb().prepare('SELECT * FROM oauth_codes WHERE digest = ?').get(digest) as OAuthCodeRow | undefined) ?? null;
  },

  // Single use: true only for the one caller that flips used_at.
  consumeCode(digest: string, now: number): boolean {
    return getDb().prepare('UPDATE oauth_codes SET used_at = ? WHERE digest = ? AND used_at IS NULL AND expires_at > ?')
      .run(now, digest, now).changes === 1;
  },

  setCodeGrant(digest: string, grantId: string): void {
    getDb().prepare('UPDATE oauth_codes SET grant_id = ? WHERE digest = ?').run(grantId, digest);
  },

  pruneExpired(before: number): void {
    getDb().prepare('DELETE FROM oauth_authorization_requests WHERE expires_at < ?').run(before);
    getDb().prepare('DELETE FROM oauth_codes WHERE expires_at < ?').run(before);
  },
};
