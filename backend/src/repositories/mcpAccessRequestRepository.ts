import { getDb } from '../persistence/database.js';

export type McpAccessRequestStatus = 'pending' | 'approved' | 'denied';

export type McpAccessRequestRow = {
  id: number;
  user_id: string;
  namespace_id: string;
  email: string;
  note: string | null;
  status: McpAccessRequestStatus;
  created_at: number;
  resolved_at: number | null;
};

export type McpAccessRequestListItem = McpAccessRequestRow & {
  namespace_name: string | null;
  tier: string | null;
};

export const mcpAccessRequestRepository = {
  // Returns the new id, or null when the user already has an open request.
  create(input: { userId: string; namespaceId: string; email: string; note: string | null; now: number }): number | null {
    const result = getDb().prepare(`
      INSERT OR IGNORE INTO mcp_access_requests (user_id, namespace_id, email, note, created_at) VALUES (?, ?, ?, ?, ?)
    `).run(input.userId, input.namespaceId, input.email, input.note, input.now);
    return result.changes > 0 ? Number(result.lastInsertRowid) : null;
  },

  // The user's most recent request, open or not.
  getLatestForUser(userId: string): McpAccessRequestRow | null {
    return (getDb().prepare('SELECT * FROM mcp_access_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId) as McpAccessRequestRow | undefined) ?? null;
  },

  countSince(userId: string, since: number): number {
    const row = getDb().prepare('SELECT COUNT(*) AS count FROM mcp_access_requests WHERE user_id = ? AND created_at >= ?').get(userId, since) as { count: number };
    return row.count;
  },

  get(id: number): McpAccessRequestRow | null {
    return (getDb().prepare('SELECT * FROM mcp_access_requests WHERE id = ?').get(id) as McpAccessRequestRow | undefined) ?? null;
  },

  list(status?: McpAccessRequestStatus): McpAccessRequestListItem[] {
    const where = status ? 'WHERE r.status = ?' : '';
    return getDb().prepare(`
      SELECT r.*, n.name AS namespace_name, n.tier AS tier
      FROM mcp_access_requests r LEFT JOIN namespaces n ON n.id = r.namespace_id
      ${where}
      ORDER BY r.id DESC LIMIT 200
    `).all(...(status ? [status] : [])) as McpAccessRequestListItem[];
  },

  resolve(id: number, status: 'approved' | 'denied', now: number): boolean {
    return getDb().prepare("UPDATE mcp_access_requests SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'")
      .run(status, now, id).changes > 0;
  },

  // Closes a user's open request, e.g. when access was granted some other way.
  resolveOpenForUser(userId: string, status: 'approved' | 'denied', now: number): boolean {
    return getDb().prepare("UPDATE mcp_access_requests SET status = ?, resolved_at = ? WHERE user_id = ? AND status = 'pending'")
      .run(status, now, userId).changes > 0;
  },
};
