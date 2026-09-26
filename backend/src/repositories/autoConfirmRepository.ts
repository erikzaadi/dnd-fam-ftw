import { getDb } from '../persistence/database.js';

// Per player and adventure: may an AI assistant send clean previews after an Undo
// window (like the website's typed actions)? On unless the player chose "always ask me
// first" for that adventure (a row with enabled = 0).
export const autoConfirmRepository = {
  isEnabled(userId: string, sessionId: string): boolean {
    const row = getDb().prepare('SELECT enabled FROM mcp_auto_confirm WHERE user_id = ? AND session_id = ?').get(userId, sessionId) as { enabled: number } | undefined;
    return row ? row.enabled === 1 : true;
  },

  set(userId: string, sessionId: string, enabled: boolean, now: number): void {
    getDb().prepare(`
      INSERT INTO mcp_auto_confirm (user_id, session_id, enabled, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, session_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
    `).run(userId, sessionId, enabled ? 1 : 0, now);
  },

  disabledSessionIds(userId: string): Set<string> {
    const rows = getDb().prepare('SELECT session_id FROM mcp_auto_confirm WHERE user_id = ? AND enabled = 0').all(userId) as { session_id: string }[];
    return new Set(rows.map(row => row.session_id));
  },
};
