import { getDb } from '../persistence/database.js';

export type InviteRequest = {
  id: number;
  email: string;
  message: string | null;
  created_at: string;
};

export const inviteRequestRepository = {
  hasInviteRequest(email: string): boolean {
    const db = getDb();
    const row = db.prepare('SELECT id FROM invite_requests WHERE email = ?').get(email) as { id: number } | undefined;
    return !!row;
  },

  addInviteRequest(email: string, message?: string): void {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_requests (email, message) VALUES (?, ?)').run(email, message ?? null);
  },

  listInviteRequests(): InviteRequest[] {
    const db = getDb();
    return db.prepare('SELECT id, email, message, created_at FROM invite_requests ORDER BY created_at DESC').all() as InviteRequest[];
  },

  clearInviteRequests(): number {
    const db = getDb();
    const result = db.prepare('DELETE FROM invite_requests').run();
    return result.changes;
  },
};
