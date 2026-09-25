import { getDb } from '../persistence/database.js';

export type LimitRequestStatus = 'pending' | 'approved' | 'denied';

export type LimitRequestRow = {
  id: number;
  namespace_id: string;
  user_id: string | null;
  email: string | null;
  note: string | null;
  status: LimitRequestStatus;
  created_at: string;
  resolved_at: string | null;
};

export type LimitRequestListItem = LimitRequestRow & {
  namespace_name: string | null;
  tier: string | null;
};

export const limitRequestRepository = {
  // Returns the new id, or null when the namespace already has an open request.
  create(namespaceId: string, userId: string | null, email: string | null, note: string | null): number | null {
    const result = getDb().prepare(`
      INSERT OR IGNORE INTO limit_requests (namespace_id, user_id, email, note) VALUES (?, ?, ?, ?)
    `).run(namespaceId, userId, email, note);
    return result.changes > 0 ? Number(result.lastInsertRowid) : null;
  },

  getOpen(namespaceId: string): LimitRequestRow | null {
    return (getDb().prepare("SELECT * FROM limit_requests WHERE namespace_id = ? AND status = 'pending'").get(namespaceId) as LimitRequestRow | undefined) ?? null;
  },

  countSince(namespaceId: string, since: string): number {
    const row = getDb().prepare('SELECT COUNT(*) AS count FROM limit_requests WHERE namespace_id = ? AND created_at >= ?').get(namespaceId, since) as { count: number };
    return row.count;
  },

  get(id: number): LimitRequestRow | null {
    return (getDb().prepare('SELECT * FROM limit_requests WHERE id = ?').get(id) as LimitRequestRow | undefined) ?? null;
  },

  list(status?: LimitRequestStatus): LimitRequestListItem[] {
    const where = status ? 'WHERE lr.status = ?' : '';
    return getDb().prepare(`
      SELECT lr.*, n.name AS namespace_name, n.tier AS tier
      FROM limit_requests lr LEFT JOIN namespaces n ON n.id = lr.namespace_id
      ${where}
      ORDER BY lr.id DESC LIMIT 200
    `).all(...(status ? [status] : [])) as LimitRequestListItem[];
  },

  resolve(id: number, status: 'approved' | 'denied'): boolean {
    return getDb().prepare("UPDATE limit_requests SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
      .run(status, id).changes > 0;
  },
};
