import { createId } from '../lib/ids.js';
import { getDb } from '../persistence/database.js';

export type NamespaceListItem = {
  id: string;
  name: string;
  user_count: number;
  session_count: number;
  max_sessions: number | null;
  max_turns: number | null;
  created_at: string;
};

export const namespaceRepository = {
  listNamespaces(): NamespaceListItem[] {
    const db = getDb();
    return db.prepare(`
      SELECT
        n.id, n.name, n.created_at, n.max_sessions, n.max_turns,
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

  createNamespace(name: string): { namespaceId: string } {
    const db = getDb();
    const namespaceId = createId();
    db.prepare('INSERT INTO namespaces (id, name) VALUES (?, ?)').run(namespaceId, name);
    return { namespaceId };
  },

  renameNamespace(id: string, newName: string): boolean {
    const db = getDb();
    const result = db.prepare('UPDATE namespaces SET name = ? WHERE id = ?').run(newName, id);
    return result.changes > 0;
  },

  deleteNamespace(id: string): { ok: boolean; reason?: string } {
    const db = getDb();
    if (id === 'local') {
      return { ok: false, reason: 'Cannot delete the local namespace' };
    }
    const users = db.prepare('SELECT COUNT(*) as count FROM users WHERE namespace_id = ?').get(id) as { count: number };
    if (users.count > 0) {
      return { ok: false, reason: `Namespace has ${users.count} user(s) - remove them first` };
    }
    const sessions = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE namespace_id = ?').get(id) as { count: number };
    if (sessions.count > 0) {
      return { ok: false, reason: `Namespace has ${sessions.count} session(s) - delete them first` };
    }
    db.prepare('DELETE FROM namespaces WHERE id = ?').run(id);
    return { ok: true };
  },

  getNamespaceLimits(namespaceId: string): { maxSessions: number | null; maxTurns: number | null } {
    const db = getDb();
    const row = db.prepare('SELECT max_sessions, max_turns FROM namespaces WHERE id = ?').get(namespaceId) as { max_sessions: number | null; max_turns: number | null } | undefined;
    return { maxSessions: row?.max_sessions ?? null, maxTurns: row?.max_turns ?? null };
  },

  setNamespaceLimits(namespaceId: string, maxSessions: number | null, maxTurns: number | null): boolean {
    const db = getDb();
    const result = db.prepare('UPDATE namespaces SET max_sessions = ?, max_turns = ? WHERE id = ?').run(maxSessions, maxTurns, namespaceId);
    return result.changes > 0;
  },
};
