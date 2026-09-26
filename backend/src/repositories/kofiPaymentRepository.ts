import { getDb } from '../persistence/database.js';

// upgraded: the group became (or stayed) a supporter until supporter_until.
// already_upgraded: the group has a tier that never expires (unlimited, or an owner-set supporter).
// no_account: no user has the donor email; the owner decides by hand.
// needs_review: the donor has an account but owns no realm, or several; decided by hand.
export type KofiPaymentOutcome = 'upgraded' | 'already_upgraded' | 'no_account' | 'needs_review';

export type KofiPaymentRow = {
  transaction_id: string;
  type: string;
  email_canonical: string | null;
  from_name: string | null;
  amount: string | null;
  currency: string | null;
  message: string | null;
  outcome: KofiPaymentOutcome;
  namespace_id: string | null;
  supporter_until: number | null;
  kofi_timestamp: string | null;
  created_at: string;
};

export type NewKofiPayment = Omit<KofiPaymentRow, 'created_at'>;

export const kofiPaymentRepository = {
  // False when the transaction was already recorded (a Ko-fi retry).
  insert(payment: NewKofiPayment): boolean {
    return getDb().prepare(`
      INSERT OR IGNORE INTO kofi_payments
        (transaction_id, type, email_canonical, from_name, amount, currency, message, outcome, namespace_id, supporter_until, kofi_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payment.transaction_id, payment.type, payment.email_canonical, payment.from_name, payment.amount,
      payment.currency, payment.message, payment.outcome, payment.namespace_id, payment.supporter_until, payment.kofi_timestamp,
    ).changes > 0;
  },

  exists(transactionId: string): boolean {
    return !!getDb().prepare('SELECT 1 FROM kofi_payments WHERE transaction_id = ?').get(transactionId);
  },

  // since: SQLite timestamp ('YYYY-MM-DD HH:MM:SS', UTC), compared with created_at.
  list({ outcome, since }: { outcome?: KofiPaymentOutcome; since?: string } = {}): (KofiPaymentRow & { namespace_name: string | null })[] {
    const where: string[] = [];
    const params: string[] = [];
    if (outcome) {
      where.push('kp.outcome = ?');
      params.push(outcome);
    }
    if (since) {
      where.push('kp.created_at >= ?');
      params.push(since);
    }
    return getDb().prepare(`
      SELECT kp.*, n.name AS namespace_name
      FROM kofi_payments kp LEFT JOIN namespaces n ON n.id = kp.namespace_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY kp.created_at DESC LIMIT 200
    `).all(...params) as (KofiPaymentRow & { namespace_name: string | null })[];
  },
};
