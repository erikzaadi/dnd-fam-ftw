import crypto from 'crypto';
import { getConfig, isDeviceSignInEnabled } from '../config/env.js';
import { devLog } from '../lib/devLog.js';
import { withTransaction } from '../persistence/transaction.js';
import { realmAccess } from '../realms/access.js';
import { devicePairingRepository, type DeviceGrantRow, type DeviceMetrics, type DeviceRevokeReason } from '../repositories/devicePairingRepository.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import type { DeviceGrantSummary } from '../types.js';
import { hitRateLimit } from './authRateLimit.js';
import { enqueueDeviceSignInNotice, safeSingleLine } from './emailService.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const PAIRING_TTL_MS = 10 * MINUTE_MS;
const POLL_INTERVAL_SECONDS = 5;
// Polls slightly early (timer drift on TV browsers) are not punished.
const POLL_TOLERANCE_MS = 1000;
const IDLE_LIMIT_MS = 30 * DAY_MS;
const MAX_AGE_MS = 60 * DAY_MS;
const MAX_ACTIVE_DEVICES = 5;
const TOUCH_INTERVAL_MS = HOUR_MS;
const RETENTION_MS = 90 * DAY_MS;
const STARTS_PER_IP_PER_HOUR = 10;
const CODE_CHECKS_PER_USER = 10;
const CODE_CHECKS_PER_IP = 30;
const CODE_CHECK_WINDOW_MS = 10 * MINUTE_MS;
// No vowels (no words) and no lookalikes: about 2.6e10 codes.
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const CODE_LENGTH = 8;
const USER_AGENT_MAX = 200;

export type StartPairingResult =
  | { status: 'started'; deviceToken: string; userCode: string; expiresInSeconds: number; intervalSeconds: number }
  | { status: 'rate_limited'; retryAfterSeconds: number };

export type DeviceIdentity = { userId: string; email: string; namespaceId: string; grantId: string; maxExpiresAt: number };

export type PollResult =
  | { status: 'pending' | 'slow_down' | 'denied' | 'expired' }
  | { status: 'approved'; identity: DeviceIdentity };

export type CodeCheckFailure = { status: 'invalid_code' } | { status: 'rate_limited'; retryAfterSeconds: number };

export type LookupResult = { status: 'found'; deviceLabel: string; createdAt: number; expiresAt: number } | CodeCheckFailure;

export type ApproveResult =
  | { status: 'approved'; deviceLabel: string; signedOutLabel: string | null }
  | { status: 'not_member' }
  | CodeCheckFailure;

export type DenyResult = { status: 'denied' } | CodeCheckFailure;

export type GrantCheck = { ok: true; maxExpiresAt: number } | { ok: false };

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

let hmacKey: Buffer | null = null;
const codeHmac = (code: string): string => {
  if (!hmacKey) {
    const config = getConfig();
    // Domain-separated from email codes and JWT signing.
    hmacKey = crypto.createHmac('sha256', config.EMAIL_CODE_HMAC_SECRET ?? config.JWT_SECRET ?? '').update('device-pairing-code').digest();
  }
  return crypto.createHmac('sha256', hmacKey).update(code).digest('hex');
};

const generateCode = (): string =>
  Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');

// Uppercase, dashes and spaces stripped. Anything else is not a code.
export const normalizeUserCode = (raw: unknown): string | null => {
  if (typeof raw !== 'string') {
    return null;
  }
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return code.length === CODE_LENGTH && [...code].every(c => CODE_ALPHABET.includes(c)) ? code : null;
};

const formatUserCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

// A coarse, human label from the TV's user agent. Display only, never trusted.
function deviceLabelFromUserAgent(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const known: [RegExp, string][] = [
    [/Tizen|SMART-TV.*Samsung|SamsungBrowser.*TV/i, 'Samsung TV browser'],
    [/Web0S|webOS|NetCast/i, 'LG TV browser'],
    [/AFT[A-Z]|Fire TV/i, 'Fire TV browser'],
    [/Android TV|GoogleTV|BRAVIA/i, 'Android TV browser'],
    [/CrKey/i, 'Chromecast'],
    [/PlayStation/i, 'PlayStation browser'],
    [/Xbox/i, 'Xbox browser'],
    [/Roku/i, 'Roku browser'],
    [/Macintosh|Mac OS X/i, 'Mac browser'],
    [/Windows/i, 'Windows browser'],
    [/Android/i, 'Android browser'],
    [/iPhone|iPad/i, 'iOS browser'],
    [/Linux/i, 'Linux browser'],
  ];
  return known.find(([pattern]) => pattern.test(ua))?.[1] ?? 'TV browser';
}

const isActive = (grant: DeviceGrantRow, now: number): boolean =>
  grant.revoked_at === null && grant.last_seen_at > now - IDLE_LIMIT_MS && grant.max_expires_at > now;

function logSignOut(grantId: string, userId: string, reason: DeviceRevokeReason | 'kill-switch'): void {
  console.log(`[Auth] Device signed out grantId=${grantId} userId=${userId} reason=${reason}`);
}

function checkCodeAttempts(userId: string, ip: string, now: number): number | null {
  const user = hitRateLimit(`device-code:user:${userId}`, CODE_CHECK_WINDOW_MS, CODE_CHECKS_PER_USER, now);
  const byIp = hitRateLimit(`device-code:ip:${ip}`, CODE_CHECK_WINDOW_MS, CODE_CHECKS_PER_IP, now);
  if (user === null && byIp === null) {
    return null;
  }
  console.warn(`[Auth] Device code check rate limited userId=${userId}`);
  return Math.max(user ?? 0, byIp ?? 0);
}

// Looks up an open pairing by its code, counting the attempt against the rate limits.
function findPendingPairing(rawCode: unknown, userId: string, ip: string, now: number) {
  const retryAfterSeconds = checkCodeAttempts(userId, ip, now);
  if (retryAfterSeconds !== null) {
    return { status: 'rate_limited', retryAfterSeconds } as const;
  }
  const code = normalizeUserCode(rawCode);
  const pairing = code ? devicePairingRepository.getPendingByCode(codeHmac(code), now) : null;
  return pairing ? { status: 'found', pairing } as const : { status: 'invalid_code' } as const;
}

// Starts a pairing on the TV. A previous device token from the same browser drops its
// open code, so only the newest code shown on screen can be approved.
export function startPairing(previousDeviceToken: string | undefined, userAgent: string | undefined, ip: string, now: number = Date.now()): StartPairingResult {
  const retryAfterSeconds = hitRateLimit(`device-start:ip:${ip}`, HOUR_MS, STARTS_PER_IP_PER_HOUR, now);
  if (retryAfterSeconds !== null) {
    console.warn('[Auth] Device pairing start rate limited');
    return { status: 'rate_limited', retryAfterSeconds };
  }
  if (previousDeviceToken) {
    devicePairingRepository.supersedePending(sha256(previousDeviceToken));
  }
  const deviceToken = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomBytes(12).toString('base64url');
  // The code column is unique; a collision with a code from the last 90 days is retried.
  for (let attempt = 0; ; attempt++) {
    const userCode = generateCode();
    try {
      devicePairingRepository.createPairing({
        id,
        device_hash: sha256(deviceToken),
        user_code_hmac: codeHmac(userCode),
        user_agent: userAgent?.slice(0, USER_AGENT_MAX) ?? null,
        created_at: now,
        expires_at: now + PAIRING_TTL_MS,
      });
      devLog.log(`[Auth] Device pairing started pairingId=${id}`);
      return { status: 'started', deviceToken, userCode: formatUserCode(userCode), expiresInSeconds: PAIRING_TTL_MS / 1000, intervalSeconds: POLL_INTERVAL_SECONDS };
    } catch (err) {
      if (attempt >= 2) {
        throw err;
      }
    }
  }
}

// Polled by the TV. Approved stays repeatable until the pairing expires, always for the
// same grant, so a TV whose response was lost can recover.
export function pollPairing(deviceToken: string | undefined, now: number = Date.now()): PollResult {
  const pairing = deviceToken ? devicePairingRepository.getByDeviceHash(sha256(deviceToken)) : null;
  if (!pairing || pairing.status === 'superseded' || pairing.expires_at <= now) {
    return { status: 'expired' };
  }
  if (pairing.status === 'denied') {
    return { status: 'denied' };
  }
  if (pairing.status === 'pending') {
    const tooSoon = pairing.last_polled_at !== null && now - pairing.last_polled_at < POLL_INTERVAL_SECONDS * 1000 - POLL_TOLERANCE_MS;
    devicePairingRepository.recordPoll(pairing.id, now);
    return { status: tooSoon ? 'slow_down' : 'pending' };
  }
  const grant = pairing.grant_id ? devicePairingRepository.getGrant(pairing.grant_id) : null;
  const user = grant ? userRepository.getUserById(grant.user_id) : null;
  if (!grant || !user || !isActive(grant, now)) {
    return { status: 'expired' };
  }
  devicePairingRepository.markClaimed(pairing.id, now);
  return { status: 'approved', identity: { userId: user.id, email: user.email, namespaceId: grant.namespace_id, grantId: grant.id, maxExpiresAt: grant.max_expires_at } };
}

export function lookupPairing(rawCode: unknown, userId: string, ip: string, now: number = Date.now()): LookupResult {
  const found = findPendingPairing(rawCode, userId, ip, now);
  if (found.status !== 'found') {
    return found;
  }
  const { pairing } = found;
  return { status: 'found', deviceLabel: deviceLabelFromUserAgent(pairing.user_agent), createdAt: pairing.created_at, expiresAt: pairing.expires_at };
}

// Approval creates the grant, signs out the oldest TV past the cap and queues the
// notice, all in one transaction, so the reply and the email name the same TV.
export function approvePairing(
  input: { code: unknown; userId: string; namespaceId: string; label?: unknown },
  ip: string,
  now: number = Date.now(),
): ApproveResult {
  const found = findPendingPairing(input.code, input.userId, ip, now);
  if (found.status !== 'found') {
    return found;
  }
  const { pairing } = found;
  const user = userRepository.getUserById(input.userId);
  const realm = namespaceRepository.getNamespaceById(input.namespaceId);
  if (!user || !realm || !realmAccess.isMember(input.userId, input.namespaceId)) {
    return { status: 'not_member' };
  }
  const deviceLabel = safeSingleLine(typeof input.label === 'string' ? input.label : '', deviceLabelFromUserAgent(pairing.user_agent));
  const grantId = crypto.randomBytes(16).toString('base64url');

  const evicted = withTransaction((): DeviceGrantRow | null | false => {
    // Conditional on still pending: a racing approval or denial leaves nothing written.
    if (!devicePairingRepository.approve(pairing.id, input.userId, input.namespaceId, grantId, now)) {
      return false;
    }
    const active = devicePairingRepository.listActiveGrants(input.userId, now - IDLE_LIMIT_MS, now);
    const oldest = active.length >= MAX_ACTIVE_DEVICES ? active[0] : null;
    if (oldest) {
      devicePairingRepository.revokeGrant(oldest.id, 'cap', now);
    }
    devicePairingRepository.createGrant({
      id: grantId,
      user_id: input.userId,
      namespace_id: input.namespaceId,
      label: deviceLabel,
      user_agent: pairing.user_agent,
      created_at: now,
      last_seen_at: now,
      max_expires_at: now + MAX_AGE_MS,
    });
    enqueueDeviceSignInNotice({ grantId, to: user.email, realmName: realm.name, deviceLabel, signedOutLabel: oldest?.label ?? null, approvedAt: new Date(now) });
    return oldest;
  });
  if (evicted === false) {
    return { status: 'invalid_code' };
  }
  console.log(`[Auth] Device pairing approved userId=${input.userId} namespaceId=${input.namespaceId} grantId=${grantId}`);
  if (evicted) {
    logSignOut(evicted.id, input.userId, 'cap');
  }
  return { status: 'approved', deviceLabel, signedOutLabel: evicted?.label ?? null };
}

export function denyPairing(rawCode: unknown, userId: string, ip: string, now: number = Date.now()): DenyResult {
  const found = findPendingPairing(rawCode, userId, ip, now);
  if (found.status !== 'found') {
    return found;
  }
  if (!devicePairingRepository.deny(found.pairing.id, now)) {
    return { status: 'invalid_code' };
  }
  console.log(`[Auth] Device pairing denied userId=${userId} pairingId=${found.pairing.id}`);
  return { status: 'denied' };
}

// Logged once per grant and process; kill-switch rejections never revoke.
const killSwitchLogged = new Set<string>();

// Checked on every request that carries a TV sign-in.
export function checkDeviceGrant(grantId: string, userId: string, namespaceId: string, now: number = Date.now()): GrantCheck {
  const grant = devicePairingRepository.getGrant(grantId);
  if (!grant || grant.user_id !== userId || grant.namespace_id !== namespaceId || grant.revoked_at !== null) {
    return { ok: false };
  }
  if (!isDeviceSignInEnabled()) {
    if (!killSwitchLogged.has(grantId)) {
      killSwitchLogged.add(grantId);
      logSignOut(grantId, userId, 'kill-switch');
    }
    return { ok: false };
  }
  if (!isActive(grant, now)) {
    const reason = grant.max_expires_at <= now ? 'max-age' : 'idle';
    if (devicePairingRepository.revokeGrant(grantId, reason, now)) {
      logSignOut(grantId, userId, reason);
    }
    return { ok: false };
  }
  if (now - grant.last_seen_at >= TOUCH_INTERVAL_MS) {
    devicePairingRepository.touchGrant(grantId, now);
  }
  return { ok: true, maxExpiresAt: grant.max_expires_at };
}

export function listDeviceGrants(userId: string, now: number = Date.now()): DeviceGrantSummary[] {
  return devicePairingRepository.listActiveGrants(userId, now - IDLE_LIMIT_MS, now).map(grant => ({
    id: grant.id,
    label: grant.label,
    createdAt: grant.created_at,
    lastSeenAt: grant.last_seen_at,
    // Whichever comes first: the hard limit or 30 days without use.
    expiresAt: Math.min(grant.max_expires_at, grant.last_seen_at + IDLE_LIMIT_MS),
  }));
}

// Only the user who approved a TV can sign it out.
export function revokeDeviceGrant(grantId: string, userId: string, reason: 'user' | 'tv-logout', now: number = Date.now()): boolean {
  const grant = devicePairingRepository.getGrant(grantId);
  if (!grant || grant.user_id !== userId || !devicePairingRepository.revokeGrant(grantId, reason, now)) {
    return false;
  }
  logSignOut(grantId, userId, reason);
  return true;
}

export const deviceMetrics = (since: number, now: number = Date.now()): DeviceMetrics =>
  devicePairingRepository.metrics(since, now, now - IDLE_LIMIT_MS);

export function runDeviceMaintenance(now: number = Date.now()): void {
  for (const grant of [
    ...devicePairingRepository.revokeExpiredGrants(now - IDLE_LIMIT_MS, now),
    ...devicePairingRepository.revokeUnclaimedGrants(now),
  ]) {
    logSignOut(grant.id, grant.user_id, grant.revoked_reason);
  }
  devicePairingRepository.deleteOlderThan(now - RETENTION_MS);
}

let maintenanceTimer: ReturnType<typeof setInterval> | null = null;

export function startDeviceMaintenance(): void {
  if (maintenanceTimer) {
    return;
  }
  const run = () => {
    try {
      runDeviceMaintenance();
    } catch (err) {
      console.warn(`[Auth] Device maintenance failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  run();
  maintenanceTimer = setInterval(run, HOUR_MS);
  maintenanceTimer.unref();
}
