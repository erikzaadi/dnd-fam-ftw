import { createId } from '../lib/ids.js';
import { getDb } from '../persistence/database.js';

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
};

export const userRepository = {
  getUserByEmail(email: string): UserRecord | null {
    const db = getDb();
    return (db.prepare('SELECT id, email, namespace_id, role FROM users WHERE email = ?').get(email) as UserRecord) ?? null;
  },

  createUser(email: string, namespaceName?: string, role: string = 'member'): { userId: string; namespaceId: string } {
    const db = getDb();
    const namespaceId = createId();
    const userId = createId();
    const nsName = namespaceName ?? email.split('@')[0];
    db.prepare('INSERT INTO namespaces (id, name) VALUES (?, ?)').run(namespaceId, nsName);
    db.prepare('INSERT INTO users (id, email, namespace_id, role) VALUES (?, ?, ?, ?)').run(userId, email, namespaceId, role);
    db.prepare('INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(userId, namespaceId);
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
      SELECT u.id, u.email, u.namespace_id, n.name as namespace_name, u.role, u.created_at
      FROM users u JOIN namespaces n ON u.namespace_id = n.id
      ORDER BY u.created_at
    `).all() as (UserRecord & { namespace_name: string; created_at: string })[];
    const userNamespaces = db.prepare(`
      SELECT un.user_id, n.id, n.name
      FROM user_namespaces un JOIN namespaces n ON n.id = un.namespace_id
    `).all() as { user_id: string; id: string; name: string }[];
    return users.map(user => ({
      ...user,
      namespaces: userNamespaces.filter(un => un.user_id === user.id).map(un => ({ id: un.id, name: un.name })),
    }));
  },

  deleteUser(email: string): boolean {
    const db = getDb();
    const user = userRepository.getUserByEmail(email);
    if (!user) {
      return false;
    }
    db.prepare('DELETE FROM users WHERE email = ?').run(email);
    // Remove namespace if no other users reference it (and it's not 'local').
    if (user.namespace_id !== 'local') {
      const otherUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE namespace_id = ?').get(user.namespace_id) as { count: number };
      if (otherUsers.count === 0) {
        db.prepare('DELETE FROM namespaces WHERE id = ?').run(user.namespace_id);
      }
    }
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
      WHERE u.email = ?
      ORDER BY n.created_at
    `).all(email) as { id: string; name: string }[];
  },

  addUserToNamespace(userId: string, namespaceId: string): void {
    getDb().prepare('INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(userId, namespaceId);
  },

  removeUserFromNamespace(userId: string, namespaceId: string): boolean {
    const result = getDb().prepare('DELETE FROM user_namespaces WHERE user_id = ? AND namespace_id = ?').run(userId, namespaceId);
    return result.changes > 0;
  },
};
