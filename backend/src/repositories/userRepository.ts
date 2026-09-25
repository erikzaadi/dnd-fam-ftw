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

  // User + private namespace + membership in one transaction. Callers that need more
  // in the same transaction (self-service signup) wrap this in their own; SQLite nests
  // it as a savepoint.
  createUser(email: string, namespaceName?: string, role: string = 'member', tier: string = 'unlimited'): { userId: string; namespaceId: string } {
    const db = getDb();
    const namespaceId = createId();
    const userId = createId();
    const nsName = namespaceName ?? email.trim().split('@')[0];
    db.transaction(() => {
      db.prepare('INSERT INTO namespaces (id, name, tier) VALUES (?, ?, ?)').run(namespaceId, nsName, tier);
      db.prepare('INSERT INTO users (id, email, email_canonical, namespace_id, role) VALUES (?, ?, ?, ?, ?)')
        .run(userId, email.trim(), canonicalEmail(email), namespaceId, role);
      db.prepare('INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(userId, namespaceId);
    })();
    return { userId, namespaceId };
  },

  createUserInExistingNamespace(email: string, namespaceId: string, role: string = 'member'): { userId: string; namespaceId: string } {
    const db = getDb();
    const userId = createId();
    db.transaction(() => {
      db.prepare('INSERT INTO users (id, email, email_canonical, namespace_id, role) VALUES (?, ?, ?, ?, ?)')
        .run(userId, email.trim(), canonicalEmail(email), namespaceId, role);
      db.prepare('INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(userId, namespaceId);
    })();
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

  deleteUser(email: string): boolean {
    const db = getDb();
    const user = userRepository.getUserByEmail(email);
    if (!user) {
      return false;
    }
    // All-or-nothing, and nothing left behind that could bind to a later account
    // with the same email (sign-in codes, pending signup notices).
    db.transaction(() => {
      db.prepare('DELETE FROM user_namespaces WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      db.prepare('DELETE FROM auth_email_challenges WHERE email_canonical = ?').run(canonicalEmail(email));
      db.prepare("UPDATE email_outbox SET status = 'cancelled' WHERE event_key = ? AND status = 'pending'").run(`signup:${user.id}`);
      // Remove namespace if no other users reference it (and it's not 'local').
      if (user.namespace_id !== 'local') {
        const otherUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE namespace_id = ?').get(user.namespace_id) as { count: number };
        if (otherUsers.count === 0) {
          db.prepare('DELETE FROM user_namespaces WHERE namespace_id = ?').run(user.namespace_id);
          db.prepare('DELETE FROM namespace_settings WHERE namespace_id = ?').run(user.namespace_id);
          db.prepare('DELETE FROM namespaces WHERE id = ?').run(user.namespace_id);
        }
      }
    })();
    return true;
  },

  setPrimaryNamespace(userId: string, namespaceId: string): void {
    const db = getDb();
    db.prepare('UPDATE users SET namespace_id = ? WHERE id = ?').run(namespaceId, userId);
    db.prepare('INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(userId, namespaceId);
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

  addUserToNamespace(userId: string, namespaceId: string): void {
    getDb().prepare('INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(userId, namespaceId);
  },

  removeUserFromNamespace(userId: string, namespaceId: string): boolean {
    const result = getDb().prepare('DELETE FROM user_namespaces WHERE user_id = ? AND namespace_id = ?').run(userId, namespaceId);
    return result.changes > 0;
  },
};
