import { getDb } from '../persistence/database.js';

export type DevicePairingStatus = 'pending' | 'approved' | 'denied' | 'superseded';

export type DevicePairingRow = {
  id: string;
  device_hash: string;
  user_code_hmac: string;
  user_agent: string | null;
  created_at: number;
  expires_at: number;
  last_polled_at: number | null;
  status: DevicePairingStatus;
  approved_user_id: string | null;
  approved_namespace_id: string | null;
  approved_at: number | null;
  denied_at: number | null;
  claimed_at: number | null;
  grant_id: string | null;
};

export type DeviceRevokeReason = 'user' | 'cap' | 'tv-logout' | 'idle' | 'max-age' | 'unclaimed';

export type DeviceGrantRow = {
  id: string;
  user_id: string;
  namespace_id: string;
  label: string;
  user_agent: string | null;
  created_at: number;
  last_seen_at: number;
  max_expires_at: number;
  revoked_at: number | null;
  revoked_reason: DeviceRevokeReason | null;
};

export type RevokedGrant = { id: string; user_id: string; revoked_reason: DeviceRevokeReason };

// Timestamps are epoch milliseconds.
export const devicePairingRepository = {
  createPairing(row: Pick<DevicePairingRow, 'id' | 'device_hash' | 'user_code_hmac' | 'user_agent' | 'created_at' | 'expires_at'>): void {
    getDb().prepare(`
      INSERT INTO device_pairings (id, device_hash, user_code_hmac, user_agent, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(row.id, row.device_hash, row.user_code_hmac, row.user_agent, row.created_at, row.expires_at);
  },

  // A TV that starts again drops its previous code, so only the newest one can be approved.
  supersedePending(deviceHash: string): void {
    getDb().prepare("UPDATE device_pairings SET status = 'superseded' WHERE device_hash = ? AND status = 'pending'").run(deviceHash);
  },

  getByDeviceHash(deviceHash: string): DevicePairingRow | null {
    return (getDb().prepare('SELECT * FROM device_pairings WHERE device_hash = ?').get(deviceHash) as DevicePairingRow | undefined) ?? null;
  },

  getPendingByCode(userCodeHmac: string, now: number): DevicePairingRow | null {
    return (getDb().prepare("SELECT * FROM device_pairings WHERE user_code_hmac = ? AND status = 'pending' AND expires_at > ?")
      .get(userCodeHmac, now) as DevicePairingRow | undefined) ?? null;
  },

  recordPoll(id: string, now: number): void {
    getDb().prepare('UPDATE device_pairings SET last_polled_at = ? WHERE id = ?').run(now, id);
  },

  // Conditional on still pending, so two approvals cannot both win.
  approve(id: string, userId: string, namespaceId: string, grantId: string, now: number): boolean {
    return getDb().prepare(`
      UPDATE device_pairings SET status = 'approved', approved_user_id = ?, approved_namespace_id = ?, grant_id = ?, approved_at = ?
      WHERE id = ? AND status = 'pending' AND expires_at > ?
    `).run(userId, namespaceId, grantId, now, id, now).changes > 0;
  },

  deny(id: string, now: number): boolean {
    return getDb().prepare("UPDATE device_pairings SET status = 'denied', denied_at = ? WHERE id = ? AND status = 'pending' AND expires_at > ?")
      .run(now, id, now).changes > 0;
  },

  // First approved poll only; later polls reissue for the same grant.
  markClaimed(id: string, now: number): void {
    getDb().prepare('UPDATE device_pairings SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL').run(now, id);
  },

  createGrant(row: Omit<DeviceGrantRow, 'revoked_at' | 'revoked_reason'>): void {
    getDb().prepare(`
      INSERT INTO device_grants (id, user_id, namespace_id, label, user_agent, created_at, last_seen_at, max_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.user_id, row.namespace_id, row.label, row.user_agent, row.created_at, row.last_seen_at, row.max_expires_at);
  },

  getGrant(id: string): DeviceGrantRow | null {
    return (getDb().prepare('SELECT * FROM device_grants WHERE id = ?').get(id) as DeviceGrantRow | undefined) ?? null;
  },

  // Active: not revoked, used within the idle window, before the hard expiry. Oldest first.
  listActiveGrants(userId: string, idleSince: number, now: number): DeviceGrantRow[] {
    return getDb().prepare(`
      SELECT * FROM device_grants
      WHERE user_id = ? AND revoked_at IS NULL AND last_seen_at > ? AND max_expires_at > ?
      ORDER BY created_at, id
    `).all(userId, idleSince, now) as DeviceGrantRow[];
  },

  revokeGrant(id: string, reason: DeviceRevokeReason, now: number): boolean {
    return getDb().prepare('UPDATE device_grants SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL')
      .run(now, reason, id).changes > 0;
  },

  touchGrant(id: string, now: number): void {
    getDb().prepare('UPDATE device_grants SET last_seen_at = ? WHERE id = ?').run(now, id);
  },

  // Marks grants that ran out (idle or past their hard expiry) and returns them for logging.
  revokeExpiredGrants(idleSince: number, now: number): RevokedGrant[] {
    const db = getDb();
    const maxAge = db.prepare(`
      UPDATE device_grants SET revoked_at = ?, revoked_reason = 'max-age'
      WHERE revoked_at IS NULL AND max_expires_at <= ? RETURNING id, user_id, revoked_reason
    `).all(now, now) as RevokedGrant[];
    const idle = db.prepare(`
      UPDATE device_grants SET revoked_at = ?, revoked_reason = 'idle'
      WHERE revoked_at IS NULL AND last_seen_at <= ? RETURNING id, user_id, revoked_reason
    `).all(now, idleSince) as RevokedGrant[];
    return [...maxAge, ...idle];
  },

  // Grants approved for a pairing that expired without a recorded claim.
  revokeUnclaimedGrants(now: number): RevokedGrant[] {
    return getDb().prepare(`
      UPDATE device_grants SET revoked_at = ?, revoked_reason = 'unclaimed'
      WHERE revoked_at IS NULL AND id IN (
        SELECT grant_id FROM device_pairings
        WHERE status = 'approved' AND claimed_at IS NULL AND expires_at <= ? AND grant_id IS NOT NULL
      ) RETURNING id, user_id, revoked_reason
    `).all(now, now) as RevokedGrant[];
  },

  deleteOlderThan(before: number): void {
    const db = getDb();
    db.prepare('DELETE FROM device_pairings WHERE created_at < ?').run(before);
    db.prepare('DELETE FROM device_grants WHERE revoked_at IS NOT NULL AND revoked_at < ?').run(before);
  },
};
