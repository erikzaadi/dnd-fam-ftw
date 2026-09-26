import { getDb } from '../persistence/database.js';

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'superseded';
export type InviteDeliveryStatus = 'sending' | 'sent' | 'failed';

export type NamespaceInviteRow = {
  id: string;
  namespace_id: string;
  inviter_user_id: string;
  recipient_email_canonical: string;
  recipient_user_id: string | null;
  token_digest: string;
  status: InviteStatus;
  created_at: number;
  expires_at: number;
  resolved_at: number | null;
  accepted_user_id: string | null;
  created_account: number;
  delivery_status: InviteDeliveryStatus;
  last_sent_at: number | null;
};

export type NewNamespaceInvite = Pick<NamespaceInviteRow,
  'id' | 'namespace_id' | 'inviter_user_id' | 'recipient_email_canonical' | 'recipient_user_id' | 'token_digest' | 'created_at' | 'expires_at'>;

const count = (sql: string, ...params: (string | number)[]): number =>
  (getDb().prepare(sql).get(...params) as { count: number }).count;

export const namespaceInviteRepository = {
  insert(invite: NewNamespaceInvite): void {
    getDb().prepare(`
      INSERT INTO namespace_invites (id, namespace_id, inviter_user_id, recipient_email_canonical, recipient_user_id, token_digest, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(invite.id, invite.namespace_id, invite.inviter_user_id, invite.recipient_email_canonical, invite.recipient_user_id, invite.token_digest, invite.created_at, invite.expires_at);
  },

  getById(id: string): NamespaceInviteRow | null {
    return (getDb().prepare('SELECT * FROM namespace_invites WHERE id = ?').get(id) as NamespaceInviteRow | undefined) ?? null;
  },

  getByDigest(digest: string): NamespaceInviteRow | null {
    return (getDb().prepare('SELECT * FROM namespace_invites WHERE token_digest = ?').get(digest) as NamespaceInviteRow | undefined) ?? null;
  },

  getPending(namespaceId: string, recipient: string): NamespaceInviteRow | null {
    return (getDb().prepare("SELECT * FROM namespace_invites WHERE namespace_id = ? AND recipient_email_canonical = ? AND status = 'pending'")
      .get(namespaceId, recipient) as NamespaceInviteRow | undefined) ?? null;
  },

  // Pending (including expired but not yet replaced) invitations of a realm, newest first.
  listPending(namespaceId: string, inviterUserId?: string): NamespaceInviteRow[] {
    return inviterUserId
      ? getDb().prepare("SELECT * FROM namespace_invites WHERE namespace_id = ? AND inviter_user_id = ? AND status = 'pending' ORDER BY created_at DESC").all(namespaceId, inviterUserId) as NamespaceInviteRow[]
      : getDb().prepare("SELECT * FROM namespace_invites WHERE namespace_id = ? AND status = 'pending' ORDER BY created_at DESC").all(namespaceId) as NamespaceInviteRow[];
  },

  // Conditional transition out of 'pending'; false when another request won the race.
  resolve(id: string, status: Exclude<InviteStatus, 'pending'>, now: number, accepted?: { userId: string; createdAccount: boolean }): boolean {
    return getDb().prepare(`
      UPDATE namespace_invites SET status = ?, resolved_at = ?, accepted_user_id = ?, created_account = ?
      WHERE id = ? AND status = 'pending'
    `).run(status, now, accepted?.userId ?? null, accepted?.createdAccount ? 1 : 0, id).changes > 0;
  },

  setDelivery(id: string, status: InviteDeliveryStatus, now: number): void {
    getDb().prepare('UPDATE namespace_invites SET delivery_status = ?, last_sent_at = CASE WHEN ? = \'sent\' THEN ? ELSE last_sent_at END WHERE id = ?')
      .run(status, status, now, id);
  },

  revokePendingByInviter(namespaceId: string, inviterUserId: string, now: number): number {
    return getDb().prepare("UPDATE namespace_invites SET status = 'revoked', resolved_at = ? WHERE namespace_id = ? AND inviter_user_id = ? AND status = 'pending'")
      .run(now, namespaceId, inviterUserId).changes;
  },

  revokeAllPendingByInviter(inviterUserId: string, now: number): number {
    return getDb().prepare("UPDATE namespace_invites SET status = 'revoked', resolved_at = ? WHERE inviter_user_id = ? AND status = 'pending'")
      .run(now, inviterUserId).changes;
  },

  revokeAllPending(namespaceId: string, now: number): number {
    return getDb().prepare("UPDATE namespace_invites SET status = 'revoked', resolved_at = ? WHERE namespace_id = ? AND status = 'pending'")
      .run(now, namespaceId).changes;
  },

  recordSend(inviterUserId: string, namespaceId: string, recipient: string, now: number): void {
    getDb().prepare('INSERT INTO namespace_invite_sends (inviter_user_id, namespace_id, recipient_email_canonical, created_at) VALUES (?, ?, ?, ?)')
      .run(inviterUserId, namespaceId, recipient, now);
  },

  countSendsByInviterSince(inviterUserId: string, since: number): number {
    return count('SELECT COUNT(*) AS count FROM namespace_invite_sends WHERE inviter_user_id = ? AND created_at >= ?', inviterUserId, since);
  },

  countSendsToRecipientSince(recipient: string, since: number): number {
    return count('SELECT COUNT(*) AS count FROM namespace_invite_sends WHERE recipient_email_canonical = ? AND created_at >= ?', recipient, since);
  },

  countSendsSince(since: number): number {
    return count('SELECT COUNT(*) AS count FROM namespace_invite_sends WHERE created_at >= ?', since);
  },

  countAccountsCreatedSince(since: number): number {
    return count('SELECT COUNT(*) AS count FROM namespace_invites WHERE created_account = 1 AND resolved_at >= ?', since);
  },

  // Aggregate counts for cli metrics: no emails or tokens.
  dailyStats(since: number): { day: string; sent: number; failed: number; accepted: number; new_accounts: number }[] {
    return getDb().prepare(`
      SELECT day, SUM(sent) AS sent, SUM(failed) AS failed, SUM(accepted) AS accepted, SUM(new_accounts) AS new_accounts FROM (
        SELECT date(created_at / 1000, 'unixepoch') AS day, 1 AS sent, 0 AS failed, 0 AS accepted, 0 AS new_accounts FROM namespace_invite_sends WHERE created_at >= ?
        UNION ALL
        SELECT date(created_at / 1000, 'unixepoch'), 0, CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END, 0, 0 FROM namespace_invites WHERE created_at >= ?
        UNION ALL
        SELECT date(resolved_at / 1000, 'unixepoch'), 0, 0, 1, created_account FROM namespace_invites WHERE status = 'accepted' AND resolved_at >= ?
      ) GROUP BY day ORDER BY day DESC
    `).all(since, since, since) as { day: string; sent: number; failed: number; accepted: number; new_accounts: number }[];
  },
};
