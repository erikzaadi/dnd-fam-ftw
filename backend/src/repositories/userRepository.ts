import { createId } from '../lib/ids.js';
import { getDb, runInTransaction } from '../persistence/database.js';
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

const countRows = (sql: string, ...params: string[]): number =>
  (getDb().prepare(sql).get(...params) as { count: number }).count;

// Decides which namespaces go with an account. Refuses when the user owns a realm
// with other members, when a doomed realm still has adventures (unless the caller is
// only planning), or when another account still points at a doomed realm as primary
// with nowhere else to go.
function planAccountNamespaces(user: UserRecord, { ignoreSessions = false } = {}): { ok: true; deleteNamespaceIds: string[] } | { ok: false; reason: string } {
  const db = getDb();
  const owned = db.prepare('SELECT id, name FROM namespaces WHERE owner_user_id = ?').all(user.id) as { id: string; name: string }[];
  const doomed: { id: string; name: string }[] = [];
  for (const namespace of owned) {
    const others = countRows('SELECT COUNT(*) AS count FROM user_namespaces WHERE namespace_id = ? AND user_id != ?', namespace.id, user.id);
    if (others > 0) {
      return { ok: false, reason: `${user.email} owns realm "${namespace.name}" (${namespace.id}) shared with ${others} other member(s): transfer ownership first (namespaces set-owner)` };
    }
    doomed.push(namespace);
  }
  // Pre-ownership realms: the old rule deleted the primary realm with its last user.
  const primary = db.prepare('SELECT id, name, owner_user_id FROM namespaces WHERE id = ?').get(user.namespace_id) as { id: string; name: string; owner_user_id: string | null } | undefined;
  if (primary && primary.id !== 'local' && primary.owner_user_id === null
    && countRows('SELECT COUNT(*) AS count FROM user_namespaces WHERE namespace_id = ? AND user_id != ?', primary.id, user.id) === 0) {
    doomed.push(primary);
  }
  for (const namespace of doomed) {
    const sessions = countRows('SELECT COUNT(*) AS count FROM sessions WHERE namespace_id = ?', namespace.id);
    if (sessions > 0 && !ignoreSessions) {
      return { ok: false, reason: `Realm "${namespace.name}" (${namespace.id}) still has ${sessions} adventure(s): delete them first` };
    }
    const stranded = db.prepare('SELECT id, email FROM users WHERE namespace_id = ? AND id != ?').all(namespace.id, user.id) as { id: string; email: string }[];
    for (const other of stranded) {
      const next = userRepository.getPrimaryCandidates(other.id, namespace.id).find(id => !doomed.some(d => d.id === id));
      if (!next) {
        return { ok: false, reason: `${other.email} has realm "${namespace.name}" as primary and no other realm: remove that user first` };
      }
    }
  }
  return { ok: true, deleteNamespaceIds: doomed.map(namespace => namespace.id) };
}

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
  db.prepare('DELETE FROM namespaces WHERE id = ?').run(namespaceId);
}

// The first member of a realm that has no owner yet becomes its owner. Never replaces
// an existing owner, and 'local' stays ownerless.
function claimOwnerIfNone(userId: string, namespaceId: string): void {
  getDb().prepare("UPDATE namespaces SET owner_user_id = ? WHERE id = ? AND owner_user_id IS NULL AND id != 'local'").run(userId, namespaceId);
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

  // User + private namespace (owned by the new user) + membership in one transaction. Inside a caller's
  // transaction (self-service signup) it joins that one instead.
  createUser(email: string, namespaceName?: string, role: string = 'member', tier: string = 'unlimited'): { userId: string; namespaceId: string } {
    const db = getDb();
    const namespaceId = createId();
    const userId = createId();
    const nsName = namespaceName ?? email.trim().split('@')[0];
    runInTransaction(() => {
      db.prepare('INSERT INTO namespaces (id, name, tier) VALUES (?, ?, ?)').run(namespaceId, nsName, tier);
      db.prepare('INSERT INTO users (id, email, email_canonical, namespace_id, role) VALUES (?, ?, ?, ?, ?)')
        .run(userId, email.trim(), canonicalEmail(email), namespaceId, role);
      db.prepare('INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(userId, namespaceId);
      // The namespace row comes first (users.namespace_id references it), so the
      // owner is set once the user exists, before commit.
      db.prepare('UPDATE namespaces SET owner_user_id = ? WHERE id = ?').run(userId, namespaceId);
    });
    return { userId, namespaceId };
  },

  // Joins an existing namespace as an ordinary member. Owner only when the namespace
  // had none yet (an empty realm from cli namespaces create).
  createUserInExistingNamespace(email: string, namespaceId: string, role: string = 'member'): { userId: string; namespaceId: string } {
    const db = getDb();
    const userId = createId();
    runInTransaction(() => {
      db.prepare('INSERT INTO users (id, email, email_canonical, namespace_id, role) VALUES (?, ?, ?, ?, ?)')
        .run(userId, email.trim(), canonicalEmail(email), namespaceId, role);
      db.prepare('INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(userId, namespaceId);
      claimOwnerIfNone(userId, namespaceId);
    });
    return { userId, namespaceId };
  },

  ensureAdminUser(email: string): void {
    const existing = userRepository.getUserByEmail(email);
    if (existing) {
      console.log(`[Auth] Admin user already exists: ${email} (namespace: ${existing.namespace_id})`);
      return;
    }
    const { userId, namespaceId } = userRepository.createUser(email, 'Admin', 'admin');
    console.log(`[Auth] Created admin user: ${email} userId=${userId} namespaceId=${namespaceId}`);
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

  // All-or-nothing. A user who owns a realm shared with others is refused (transfer
  // ownership first). Realms that go with the account: ones they own alone, and a
  // legacy ownerless primary realm where they are the only member. Those must have no
  // adventures left (the CLI deletes them first, with their images). Shared realms
  // are never deleted just because this user's primary reference goes away.
  deleteUser(email: string): DeleteUserResult {
    const db = getDb();
    const user = userRepository.getUserByEmail(email);
    if (!user) {
      return { ok: false, notFound: true, reason: `User not found: ${email}` };
    }
    const plan = planAccountNamespaces(user);
    if (!plan.ok) {
      return plan;
    }
    // Nothing left behind that could bind to a later account with the same email
    // (sign-in codes, pending signup notices).
    runInTransaction(() => {
      for (const namespaceId of plan.deleteNamespaceIds) {
        // Break the users <-> namespaces reference cycle before deleting either row.
        db.prepare('UPDATE namespaces SET owner_user_id = NULL WHERE id = ?').run(namespaceId);
      }
      db.prepare('DELETE FROM user_namespaces WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM access_tokens WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM mcp_auto_confirm WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM mcp_access_requests WHERE user_id = ?').run(user.id);
      db.prepare("UPDATE namespace_invites SET status = 'revoked', resolved_at = ? WHERE inviter_user_id = ? AND status = 'pending'").run(Date.now(), user.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      db.prepare('DELETE FROM auth_email_challenges WHERE email_canonical = ?').run(canonicalEmail(email));
      db.prepare("UPDATE email_outbox SET status = 'cancelled' WHERE event_key = ? AND status = 'pending'").run(`signup:${user.id}`);
      for (const namespaceId of plan.deleteNamespaceIds) {
        deleteNamespaceRows(namespaceId);
      }
    });
    return { ok: true, deletedNamespaceIds: plan.deleteNamespaceIds };
  },

  // Namespaces that would be deleted with this account, or why deletion is refused.
  planAccountDeletion(email: string): { ok: true; deleteNamespaceIds: string[] } | { ok: false; reason: string } {
    const user = userRepository.getUserByEmail(email);
    if (!user) {
      return { ok: false, reason: `User not found: ${email}` };
    }
    const plan = planAccountNamespaces(user, { ignoreSessions: true });
    return plan.ok ? { ok: true, deleteNamespaceIds: plan.deleteNamespaceIds } : plan;
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

  setPrimaryNamespace(userId: string, namespaceId: string): void {
    const db = getDb();
    db.prepare('UPDATE users SET namespace_id = ? WHERE id = ?').run(namespaceId, userId);
    db.prepare('INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(userId, namespaceId);
    claimOwnerIfNone(userId, namespaceId);
  },

  getUserNamespaces(email: string): { id: string; name: string }[] {
    const db = getDb();
    return db.prepare(`
      SELECT n.id, n.name
      FROM namespaces n
      JOIN user_namespaces un ON un.namespace_id = n.id
      JOIN users u ON u.id = un.user_id
      WHERE u.email_canonical = ?
      ORDER BY n.created_at
    `).all(canonicalEmail(email)) as { id: string; name: string }[];
  },

  isNamespaceMember(userId: string, namespaceId: string): boolean {
    return !!getDb().prepare('SELECT 1 FROM user_namespaces WHERE user_id = ? AND namespace_id = ?').get(userId, namespaceId);
  },

  addUserToNamespace(userId: string, namespaceId: string): void {
    getDb().prepare('INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(userId, namespaceId);
    claimOwnerIfNone(userId, namespaceId);
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

  removeUserFromNamespace(userId: string, namespaceId: string): boolean {
    const result = getDb().prepare('DELETE FROM user_namespaces WHERE user_id = ? AND namespace_id = ?').run(userId, namespaceId);
    return result.changes > 0;
  },
};
