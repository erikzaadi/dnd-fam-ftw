import { getDb } from '../persistence/database.js';

export type OAuthClientKind = 'dcr' | 'cimd';

export type OAuthClientRow = {
  client_id: string;
  kind: OAuthClientKind;
  client_name: string | null;
  client_uri: string | null;
  redirect_uris: string;
  created_at: number;
  cache_until: number | null;
  last_used_at: number | null;
};

export const oauthClientRepository = {
  get(clientId: string): OAuthClientRow | null {
    return (getDb().prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId) as OAuthClientRow | undefined) ?? null;
  },

  insertDynamic(row: { clientId: string; clientName: string | null; clientUri: string | null; redirectUris: string[]; now: number }): void {
    getDb().prepare(`
      INSERT INTO oauth_clients (client_id, kind, client_name, client_uri, redirect_uris, created_at) VALUES (?, 'dcr', ?, ?, ?, ?)
    `).run(row.clientId, row.clientName, row.clientUri, JSON.stringify(row.redirectUris), row.now);
  },

  // Stores or refreshes a fetched Client ID Metadata Document.
  upsertMetadataDocument(row: { clientId: string; clientName: string | null; clientUri: string | null; redirectUris: string[]; cacheUntil: number; now: number }): void {
    getDb().prepare(`
      INSERT INTO oauth_clients (client_id, kind, client_name, client_uri, redirect_uris, created_at, cache_until) VALUES (?, 'cimd', ?, ?, ?, ?, ?)
      ON CONFLICT (client_id) DO UPDATE SET client_name = excluded.client_name, client_uri = excluded.client_uri,
        redirect_uris = excluded.redirect_uris, cache_until = excluded.cache_until
    `).run(row.clientId, row.clientName, row.clientUri, JSON.stringify(row.redirectUris), row.now, row.cacheUntil);
  },

  touch(clientId: string, now: number): void {
    getDb().prepare('UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ?').run(now, clientId);
  },

  // Dynamically registered clients that never completed a sign-in.
  pruneUnusedDynamic(createdBefore: number): number {
    return getDb().prepare("DELETE FROM oauth_clients WHERE kind = 'dcr' AND last_used_at IS NULL AND created_at < ?").run(createdBefore).changes;
  },
};
