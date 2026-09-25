import { getDb } from '../persistence/database.js';

export type EmailOutboxStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export type EmailOutboxRow = {
  id: number;
  event_key: string;
  recipient: string;
  subject: string;
  text_body: string;
  html_body: string;
  status: EmailOutboxStatus;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  provider_message_id: string | null;
  created_at: string;
  sent_at: string | null;
};

export type NewOutboxEmail = {
  eventKey: string;
  recipient: string;
  subject: string;
  textBody: string;
  htmlBody: string;
};

// Durable queue for operator notifications (not sign-in codes, which are sent directly).
// The unique event key keeps one logical email per event across retries and races.
export const emailOutboxRepository = {
  enqueue(email: NewOutboxEmail, now: number): void {
    getDb().prepare(`
      INSERT OR IGNORE INTO email_outbox (event_key, recipient, subject, text_body, html_body, next_attempt_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(email.eventKey, email.recipient, email.subject, email.textBody, email.htmlBody, now);
  },

  listDue(now: number, limit: number): EmailOutboxRow[] {
    return getDb().prepare(`
      SELECT * FROM email_outbox WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT ?
    `).all(now, limit) as EmailOutboxRow[];
  },

  // Counted before sending, so a crash mid-send still uses up an attempt.
  markAttempt(id: number): void {
    getDb().prepare('UPDATE email_outbox SET attempts = attempts + 1 WHERE id = ?').run(id);
  },

  markSent(id: number, providerMessageId: string | null): void {
    getDb().prepare("UPDATE email_outbox SET status = 'sent', provider_message_id = ?, last_error = NULL, sent_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(providerMessageId, id);
  },

  markRetry(id: number, error: string, nextAttemptAt: number, maxAttempts: number): void {
    getDb().prepare(`
      UPDATE email_outbox
      SET last_error = ?, next_attempt_at = ?, status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END
      WHERE id = ?
    `).run(error.slice(0, 500), nextAttemptAt, maxAttempts, id);
  },

  list(status?: EmailOutboxStatus): EmailOutboxRow[] {
    const db = getDb();
    return status
      ? db.prepare('SELECT * FROM email_outbox WHERE status = ? ORDER BY id DESC LIMIT 200').all(status) as EmailOutboxRow[]
      : db.prepare('SELECT * FROM email_outbox ORDER BY id DESC LIMIT 200').all() as EmailOutboxRow[];
  },

  // Operator retry of a failed notification: back to pending with a fresh attempt budget.
  requeue(id: number, now: number): boolean {
    return getDb().prepare("UPDATE email_outbox SET status = 'pending', attempts = 0, next_attempt_at = ? WHERE id = ? AND status = 'failed'")
      .run(now, id).changes > 0;
  },
};
