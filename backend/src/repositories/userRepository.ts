import { createId } from '../lib/ids.js';
import { getDb } from '../persistence/database.js';
import { canonicalEmail } from '../lib/email.js';

export type UserRecord = {
  id: string;
  email: string;
  namespace_id: string;
  role: string;
};

export type UserListItem = UserRecord & {
  namespace_name: string;
  namespaces: { id: string; name: string }[];
  created_at: string;
  lastLogin: string | null;
};

// users.mcp_access: 1 = on, 0 = by realm tier, -1 = off.
export type McpAccessOverride = 'on' | 'default' | 'off';
const MCP_ACCESS_VALUES: Record<McpAccessOverride, number> = { on: 1, default: 0, off: -1 };
const fromMcpAccessValue = (value: number): McpAccessOverride => (value > 0 ? 'on' : value < 0 ? 'off' : 'default');

export type DeleteUserResult =
  | { ok: true; deletedNamespaceIds: string[] }
  | { ok: false; reason: string; notFound?: boolean };

// Deletes a namespace row and what hangs off it. Callers check members, sessions and
// primary references first. Other users still pointing at it as primary are moved
// to their next membership. provider_usage keeps its rows (no FK); the legacy
// tts_usage table references namespaces, so its rows go with the realm.
export function deleteNamespaceRows(namespaceId: string): void {
  const db = getDb();
  const stranded = db.prepare('SELECT id FROM users WHERE namespace_id = ?').all(namespaceId) as { id: string }[];
  for (const other of stranded) {
    const next = userRepository.getPrimaryCandidates(other.id, namespaceId)[0];
    if (!next) {
      throw new Error(`User ${other.id} has namespace ${namespaceId} as primary and no other membership`);
    }
    db.prepare('UPDATE users SET namespace_id = ? WHERE id = ?').run(next, other.id);
  }
  db.prepare('DELETE FROM user_namespaces WHERE namespace_id = ?').run(namespaceId);
  db.prepare('DELETE FROM namespace_settings WHERE namespace_id = ?').run(namespaceId);
  db.prepare('DELETE FROM tts_usage WHERE namespace_id = ?').run(namespaceId);
  db.prepare('DELETE FROM access_tokens WHERE namespace_id = ?').run(namespaceId);
  db.prepare('DELETE FROM oauth_tokens WHERE grant_id IN (SELECT id FROM oauth_grants WHERE namespace_id = ?)').run(namespaceId);
  db.prepare('DELETE FROM oauth_grants WHERE namespace_id = ?').run(namespaceId);
  db.prepare('DELETE FROM oauth_codes WHERE namespace_id = ?').run(namespaceId);
  db.prepare('DELETE FROM namespaces WHERE id = ?').run(namespaceId);
}

export const userRepository = {
  getUserByEmail(email: string): UserRecord | null {
    const db = getDb();
    return (db.prepare('SELECT id, email, namespace_id, role FROM users WHERE email_canonical = ?').get(canonicalEmail(email)) as UserRecord) ?? null;
  },

  getUserById(id: string): (UserRecord & { created_at: string }) | null {
    const db = getDb();
    return (db.prepare('SELECT id, email, namespace_id, role, created_at FROM users WHERE id = ?').get(id) as UserRecord & { created_at: string }) ?? null;
  },

  getUserCreatedAt(email: string): string | null {
    const row = getDb().prepare('SELECT created_at FROM users WHERE email_canonical = ?').get(canonicalEmail(email)) as { created_at: string } | undefined;
    return row?.created_at ?? null;
  },

  listUsers(): UserListItem[] {
    const db = getDb();
    const users = db.prepare(`
      SELECT u.id, u.email, u.namespace_id, n.name as namespace_name, u.role, u.created_at, u.lastLogin
      FROM users u JOIN namespaces n ON u.namespace_id = n.id
      ORDER BY u.created_at
    `).all() as (UserRecord & { namespace_name: string; created_at: string; lastLogin: string | null })[];
    const userNamespaces = db.prepare(`
      SELECT un.user_id, n.id, n.name
      FROM user_namespaces un JOIN namespaces n ON n.id = un.namespace_id
    `).all() as { user_id: string; id: string; name: string }[];
    return users.map(user => ({
      ...user,
      namespaces: userNamespaces.filter(un => un.user_id === user.id).map(un => ({ id: un.id, name: un.name })),
    }));
  },

  recordLogin(email: string): void {
    const db = getDb();
    db.prepare('UPDATE users SET lastLogin = CURRENT_TIMESTAMP WHERE email_canonical = ?').run(canonicalEmail(email));
  },

  // Remaining memberships, owned ones first, then oldest realm first.
  getPrimaryCandidates(userId: string, excludingNamespaceId: string): string[] {
    const rows = getDb().prepare(`
      SELECT n.id FROM user_namespaces un JOIN namespaces n ON n.id = un.namespace_id
      WHERE un.user_id = ? AND n.id != ?
      ORDER BY CASE WHEN n.owner_user_id = un.user_id THEN 0 ELSE 1 END, n.created_at
    `).all(userId, excludingNamespaceId) as { id: string }[];
    return rows.map(row => row.id);
  },

  isNamespaceMember(userId: string, namespaceId: string): boolean {
    return !!getDb().prepare('SELECT 1 FROM user_namespaces WHERE user_id = ? AND namespace_id = ?').get(userId, namespaceId);
  },

  // MCP access override. 'default' leaves it to the realm tier (MCP_DEFAULT_TIERS);
  // 'off' blocks the user's tokens on every request but keeps them listed.
  getMcpAccess(userId: string): McpAccessOverride {
    const row = getDb().prepare('SELECT mcp_access FROM users WHERE id = ?').get(userId) as { mcp_access: number } | undefined;
    return fromMcpAccessValue(row?.mcp_access ?? 0);
  },

  setMcpAccess(userId: string, mode: McpAccessOverride): void {
    getDb().prepare('UPDATE users SET mcp_access = ? WHERE id = ?').run(MCP_ACCESS_VALUES[mode], userId);
  },

  // Users with an explicit on or off override.
  listMcpOverrides(): { id: string; email: string; access: McpAccessOverride }[] {
    const rows = getDb().prepare('SELECT id, email, mcp_access FROM users WHERE mcp_access != 0 ORDER BY email').all() as { id: string; email: string; mcp_access: number }[];
    return rows.map(row => ({ id: row.id, email: row.email, access: fromMcpAccessValue(row.mcp_access) }));
  },

  // A user row only. Account workflows (services/accountService.ts) add the realm and
  // membership around it.
  insertUser(email: string, namespaceId: string, role: string): string {
    const userId = createId();
    getDb().prepare('INSERT INTO users (id, email, email_canonical, namespace_id, role) VALUES (?, ?, ?, ?, ?)')
      .run(userId, email.trim(), canonicalEmail(email), namespaceId, role);
    return userId;
  },

  // Deletes a user and what hangs off the account, not its realms: memberships,
  // tokens, assistant preferences and requests, OAuth grants, the user's pending
  // invitations (revoked), sign-in codes and a pending signup notice, so nothing can
  // bind to a later account with the same email.
  deleteUserRows(userId: string, emailCanonical: string, now: number): void {
    const db = getDb();
    db.prepare('DELETE FROM user_namespaces WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM access_tokens WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM mcp_auto_confirm WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM mcp_access_requests WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM oauth_tokens WHERE grant_id IN (SELECT id FROM oauth_grants WHERE user_id = ?)').run(userId);
    db.prepare('DELETE FROM oauth_grants WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM oauth_codes WHERE user_id = ?').run(userId);
    db.prepare("UPDATE namespace_invites SET status = 'revoked', resolved_at = ? WHERE inviter_user_id = ? AND status = 'pending'").run(now, userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.prepare('DELETE FROM auth_email_challenges WHERE email_canonical = ?').run(emailCanonical);
    db.prepare("UPDATE email_outbox SET status = 'cancelled' WHERE event_key = ? AND status = 'pending'").run(`signup:${userId}`);
  },

  // Plain membership and primary-pointer writes for realms/: no ownership side effects.
  insertMembership(userId: string, namespaceId: string): boolean {
    return getDb().prepare('INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(userId, namespaceId).changes > 0;
  },

  setPrimaryPointer(userId: string, namespaceId: string): void {
    getDb().prepare('UPDATE users SET namespace_id = ? WHERE id = ?').run(namespaceId, userId);
  },

  // Memberships of one user, oldest realm first.
  listNamespacesForUser(userId: string): { id: string; name: string }[] {
    return getDb().prepare(`
      SELECT n.id, n.name
      FROM namespaces n
      JOIN user_namespaces un ON un.namespace_id = n.id
      WHERE un.user_id = ?
      ORDER BY n.created_at
    `).all(userId) as { id: string; name: string }[];
  },

  removeUserFromNamespace(userId: string, namespaceId: string): boolean {
    const result = getDb().prepare('DELETE FROM user_namespaces WHERE user_id = ? AND namespace_id = ?').run(userId, namespaceId);
    return result.changes > 0;
  },
};
