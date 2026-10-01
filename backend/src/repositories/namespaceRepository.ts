import { createId } from '../lib/ids.js';
import { getDb } from '../persistence/database.js';

export type NamespaceListItem = {
  id: string;
  name: string;
  user_count: number;
  session_count: number;
  max_sessions: number | null;
  max_turns: number | null;
  tier: string;
  tier_expires_at: number | null;
  owner_email: string | null;
  created_at: string;
};

export type NamespaceMembershipRow = {
  namespace_id: string;
  namespace_name: string;
  owner_user_id: string | null;
  user_id: string | null;
  email: string | null;
  // 1 when this member has the namespace as their primary one.
  is_primary: number | null;
};

export const namespaceRepository = {
  listNamespaces(): NamespaceListItem[] {
    const db = getDb();
    return db.prepare(`
      SELECT
        n.id, n.name, n.created_at, n.max_sessions, n.max_turns, n.tier, n.tier_expires_at,
        (SELECT email FROM users WHERE id = n.owner_user_id) as owner_email,
        COUNT(DISTINCT un.user_id) as user_count,
        COUNT(DISTINCT s.id) as session_count
      FROM namespaces n
      LEFT JOIN user_namespaces un ON un.namespace_id = n.id
      LEFT JOIN sessions s ON s.namespace_id = n.id
      GROUP BY n.id
      ORDER BY n.created_at
    `).all() as NamespaceListItem[];
  },

  getNamespaceById(id: string): { id: string; name: string } | null {
    const db = getDb();
    return (db.prepare('SELECT id, name FROM namespaces WHERE id = ?').get(id) as { id: string; name: string }) ?? null;
  },

  getNamespaceByName(name: string): { id: string; name: string } | null {
    const db = getDb();
    return (db.prepare('SELECT id, name FROM namespaces WHERE name = ?').get(name) as { id: string; name: string }) ?? null;
  },

  createNamespace(name: string): { namespaceId: string } {
    const db = getDb();
    const namespaceId = createId();
    db.prepare('INSERT INTO namespaces (id, name) VALUES (?, ?)').run(namespaceId, name);
    return { namespaceId };
  },

  // A realm row with a tier, for new accounts (realms/composition). Owner set separately.
  insertNamespace(name: string, tier: string): { namespaceId: string } {
    const namespaceId = createId();
    getDb().prepare('INSERT INTO namespaces (id, name, tier) VALUES (?, ?, ?)').run(namespaceId, name, tier);
    return { namespaceId };
  },

  renameNamespace(id: string, newName: string): boolean {
    const db = getDb();
    const result = db.prepare('UPDATE namespaces SET name = ? WHERE id = ?').run(newName, id);
    return result.changes > 0;
  },

  getNamespaceLimits(namespaceId: string): { maxSessions: number | null; maxTurns: number | null } {
    const db = getDb();
    const row = db.prepare('SELECT max_sessions, max_turns FROM namespaces WHERE id = ?').get(namespaceId) as { max_sessions: number | null; max_turns: number | null } | undefined;
    return { maxSessions: row?.max_sessions ?? null, maxTurns: row?.max_turns ?? null };
  },

  getNamespaceTier(namespaceId: string): { tier: string; expiresAt: number | null } | null {
    const row = getDb().prepare('SELECT tier, tier_expires_at FROM namespaces WHERE id = ?').get(namespaceId) as { tier: string; tier_expires_at: number | null } | undefined;
    return row ? { tier: row.tier, expiresAt: row.tier_expires_at } : null;
  },

  // Owner-set tiers (CLI, approved limit requests) never expire.
  setNamespaceTier(namespaceId: string, tier: string, expiresAt: number | null = null): boolean {
    return getDb().prepare('UPDATE namespaces SET tier = ?, tier_expires_at = ? WHERE id = ?').run(tier, expiresAt, namespaceId).changes > 0;
  },

  setNamespaceLimits(namespaceId: string, maxSessions: number | null, maxTurns: number | null): boolean {
    const db = getDb();
    const result = db.prepare('UPDATE namespaces SET max_sessions = ?, max_turns = ? WHERE id = ?').run(maxSessions, maxTurns, namespaceId);
    return result.changes > 0;
  },

  getOwnerUserId(namespaceId: string): string | null {
    const row = getDb().prepare('SELECT owner_user_id FROM namespaces WHERE id = ?').get(namespaceId) as { owner_user_id: string | null } | undefined;
    return row?.owner_user_id ?? null;
  },

  setOwnerUserId(namespaceId: string, userId: string): boolean {
    return getDb().prepare('UPDATE namespaces SET owner_user_id = ? WHERE id = ?').run(userId, namespaceId).changes > 0;
  },

  // Sets the owner only when there is none yet. Rules about who may claim live in realms/.
  setOwnerIfNone(namespaceId: string, userId: string): boolean {
    return getDb().prepare('UPDATE namespaces SET owner_user_id = ? WHERE id = ? AND owner_user_id IS NULL').run(userId, namespaceId).changes > 0;
  },

  listOwnedNamespaces(userId: string): { id: string; name: string }[] {
    return getDb().prepare('SELECT id, name FROM namespaces WHERE owner_user_id = ?').all(userId) as { id: string; name: string }[];
  },

  countOtherMembers(namespaceId: string, userId: string): number {
    return (getDb().prepare('SELECT COUNT(*) AS count FROM user_namespaces WHERE namespace_id = ? AND user_id != ?').get(namespaceId, userId) as { count: number }).count;
  },

  countMembers(namespaceId: string): number {
    return (getDb().prepare('SELECT COUNT(*) AS count FROM user_namespaces WHERE namespace_id = ?').get(namespaceId) as { count: number }).count;
  },

  countSessions(namespaceId: string): number {
    return (getDb().prepare('SELECT COUNT(*) AS count FROM sessions WHERE namespace_id = ?').get(namespaceId) as { count: number }).count;
  },

  // Users whose primary pointer names this realm, members or not.
  listPrimaryReferences(namespaceId: string): { id: string; email: string }[] {
    return getDb().prepare('SELECT id, email FROM users WHERE namespace_id = ?').all(namespaceId) as { id: string; email: string }[];
  },

  // Deletes the realm row and the rows that belong to it. Plain deletes: the caller
  // (realms/) has already checked safety and moved primary pointers elsewhere.
  // provider_usage keeps its rows (no FK); the legacy tts_usage rows go with the realm.
  deleteRealmRows(namespaceId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM user_namespaces WHERE namespace_id = ?').run(namespaceId);
    db.prepare('DELETE FROM namespace_settings WHERE namespace_id = ?').run(namespaceId);
    db.prepare('DELETE FROM tts_usage WHERE namespace_id = ?').run(namespaceId);
    db.prepare('DELETE FROM access_tokens WHERE namespace_id = ?').run(namespaceId);
    db.prepare('DELETE FROM oauth_tokens WHERE grant_id IN (SELECT id FROM oauth_grants WHERE namespace_id = ?)').run(namespaceId);
    db.prepare('DELETE FROM oauth_grants WHERE namespace_id = ?').run(namespaceId);
    db.prepare('DELETE FROM oauth_codes WHERE namespace_id = ?').run(namespaceId);
    db.prepare('DELETE FROM namespaces WHERE id = ?').run(namespaceId);
  },

  clearOwner(namespaceId: string): void {
    getDb().prepare('UPDATE namespaces SET owner_user_id = NULL WHERE id = ?').run(namespaceId);
  },

  // Namespace ids this user owns.
  listOwnedNamespaceIds(userId: string): string[] {
    const rows = getDb().prepare('SELECT id FROM namespaces WHERE owner_user_id = ? ORDER BY created_at').all(userId) as { id: string }[];
    return rows.map(row => row.id);
  },

  getMemberInvitesEnabled(namespaceId: string): boolean {
    const row = getDb().prepare('SELECT member_invites_enabled FROM namespaces WHERE id = ?').get(namespaceId) as { member_invites_enabled: number } | undefined;
    return row?.member_invites_enabled === 1;
  },

  setMemberInvitesEnabled(namespaceId: string, enabled: boolean): boolean {
    return getDb().prepare('UPDATE namespaces SET member_invites_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, namespaceId).changes > 0;
  },

  // One row per (namespace, member); a namespace without members yields one row with
  // null member fields. Feeds the ownership report.
  listMembershipRows(): NamespaceMembershipRow[] {
    return getDb().prepare(`
      SELECT n.id AS namespace_id, n.name AS namespace_name, n.owner_user_id,
        u.id AS user_id, u.email, CASE WHEN u.id IS NULL THEN NULL WHEN u.namespace_id = n.id THEN 1 ELSE 0 END AS is_primary
      FROM namespaces n
      LEFT JOIN user_namespaces un ON un.namespace_id = n.id
      LEFT JOIN users u ON u.id = un.user_id
      ORDER BY n.created_at, u.created_at
    `).all() as NamespaceMembershipRow[];
  },

  // Users whose primary namespace is this one (whether or not they are still members).
  countPrimaryReferences(namespaceId: string): number {
    const row = getDb().prepare('SELECT COUNT(*) AS count FROM users WHERE namespace_id = ?').get(namespaceId) as { count: number };
    return row.count;
  },
};
