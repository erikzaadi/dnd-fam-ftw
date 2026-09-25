import { getDb } from '../persistence/database.js';

export type EmailChallengeRow = {
  id: string;
  email_canonical: string;
  code_hmac: string;
  browser_hash: string;
  created_at: number;
  last_sent_at: number;
  expires_at: number;
  attempts: number;
  consumed_at: number | null;
  superseded_at: number | null;
};

// Timestamps are epoch milliseconds.
export const authChallengeRepository = {
  // A new challenge supersedes every open challenge for the same address, so only the
  // newest code works.
  createChallenge(row: Omit<EmailChallengeRow, 'attempts' | 'consumed_at' | 'superseded_at'>): void {
    const db = getDb();
    db.transaction(() => {
      db.prepare('UPDATE auth_email_challenges SET superseded_at = ? WHERE email_canonical = ? AND consumed_at IS NULL AND superseded_at IS NULL')
        .run(row.created_at, row.email_canonical);
      db.prepare(`
        INSERT INTO auth_email_challenges (id, email_canonical, code_hmac, browser_hash, created_at, last_sent_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(row.id, row.email_canonical, row.code_hmac, row.browser_hash, row.created_at, row.last_sent_at, row.expires_at);
    })();
  },

  getChallenge(id: string): EmailChallengeRow | null {
    return (getDb().prepare('SELECT * FROM auth_email_challenges WHERE id = ?').get(id) as EmailChallengeRow | undefined) ?? null;
  },

  // Counts a verification attempt only while the challenge is still open and under
  // budget. Returns false when no attempt is left.
  recordAttempt(id: string, maxAttempts: number, now: number): boolean {
    const result = getDb().prepare(`
      UPDATE auth_email_challenges SET attempts = attempts + 1
      WHERE id = ? AND attempts < ? AND consumed_at IS NULL AND superseded_at IS NULL AND expires_at > ?
    `).run(id, maxAttempts, now);
    return result.changes > 0;
  },

  // Single use: only one caller can consume a challenge.
  consumeChallenge(id: string, now: number): boolean {
    const result = getDb().prepare(`
      UPDATE auth_email_challenges SET consumed_at = ?
      WHERE id = ? AND consumed_at IS NULL AND superseded_at IS NULL AND expires_at > ?
    `).run(now, id, now);
    return result.changes > 0;
  },

  // Resend: new code, new expiry, same challenge id and browser binding.
  rotateCode(id: string, codeHmac: string, now: number, expiresAt: number): boolean {
    const result = getDb().prepare(`
      UPDATE auth_email_challenges SET code_hmac = ?, last_sent_at = ?, expires_at = ?
      WHERE id = ? AND consumed_at IS NULL AND superseded_at IS NULL
    `).run(codeHmac, now, expiresAt, id);
    return result.changes > 0;
  },

  invalidateChallenge(id: string, now: number): void {
    getDb().prepare('UPDATE auth_email_challenges SET superseded_at = ? WHERE id = ? AND superseded_at IS NULL').run(now, id);
  },

  deleteExpired(before: number): number {
    const db = getDb();
    const challenges = db.prepare('DELETE FROM auth_email_challenges WHERE expires_at < ?').run(before).changes;
    db.prepare('DELETE FROM auth_rate_limits WHERE window_start < ?').run(before);
    return challenges;
  },

  // Fixed-window counter. Increments and returns the new count for the window.
  incrementRateLimit(bucket: string, windowStart: number): number {
    const row = getDb().prepare(`
      INSERT INTO auth_rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
      ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1
      RETURNING count
    `).get(bucket, windowStart) as { count: number };
    return row.count;
  },
};
