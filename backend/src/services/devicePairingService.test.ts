import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '../config/env.js';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { CaptureEmailProvider } from '../providers/email/CaptureEmailProvider.js';
import { setEmailProviderForTests } from '../providers/email/emailProviderFactory.js';
import { devicePairingRepository } from '../repositories/devicePairingRepository.js';
import {
  approvePairing,
  checkDeviceGrant,
  denyPairing,
  listDeviceGrants,
  lookupPairing,
  normalizeUserCode,
  pollPairing,
  revokeDeviceGrant,
  runDeviceMaintenance,
  startPairing,
} from './devicePairingService.js';
import { resolveVerifiedSignIn } from './signupService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-device-pairing-test-${Date.now()}.sqlite`);
const DAY_MS = 24 * 60 * 60 * 1000;
const TV_UA = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 SamsungBrowser/5.0 TV Safari/537.36';
let ipCounter = 0;
let userCounter = 0;
// A fresh client address per test keeps per-IP rate limits out of unrelated tests.
const nextIp = () => `10.1.0.${++ipCounter}`;

const newUser = () => {
  const outcome = resolveVerifiedSignIn(`tv-user-${++userCounter}@example.com`, 'email', new Date());
  if (outcome.kind !== 'full') {
    throw new Error(`sign-in failed: ${outcome.kind}`);
  }
  return outcome;
};

const start = (now = Date.now(), previous?: string) => {
  const result = startPairing(previous, TV_UA, nextIp(), now);
  if (result.status !== 'started') {
    throw new Error(`start failed: ${result.status}`);
  }
  return result;
};

const approve = (code: string, user: { userId: string; namespaceId: string }, now = Date.now(), label?: string) =>
  approvePairing({ code, userId: user.userId, namespaceId: user.namespaceId, label }, nextIp(), now);

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.JWT_SECRET = 'device-pairing-test-secret-that-is-long-enough';
  process.env.AUTH_MODE = 'enabled';
  process.env.SIGNUP_MODE = 'open';
  initializeDatabase();
});

beforeEach(() => {
  setEmailProviderForTests(new CaptureEmailProvider());
  delete process.env.DEVICE_SIGN_IN_DISABLED;
  resetConfigForTests();
});

afterAll(() => {
  setEmailProviderForTests(null);
  fs.rmSync(DB_PATH, { force: true });
});

describe('user codes', () => {
  it('accepts typed variants and rejects anything outside the alphabet', () => {
    expect(normalizeUserCode('wdjb-mjht')).toBe('WDJBMJHT');
    expect(normalizeUserCode(' WDJB MJHT ')).toBe('WDJBMJHT');
    expect(normalizeUserCode('WDJB-MJH')).toBeNull();
    expect(normalizeUserCode('WDJA-MJHT')).toBeNull();
    expect(normalizeUserCode(42)).toBeNull();
  });
});

describe('pairing', () => {
  it('signs the TV in after approval and keeps reissuing the same grant until expiry', () => {
    const user = newUser();
    const t0 = Date.now();
    const tv = start(t0);
    expect(tv.userCode).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
    expect(pollPairing(tv.deviceToken, t0 + 5000)).toEqual({ status: 'pending' });
    expect(pollPairing(tv.deviceToken, t0 + 6000)).toEqual({ status: 'slow_down' });

    expect(lookupPairing(tv.userCode, user.userId, nextIp(), t0 + 7000)).toMatchObject({ status: 'found', deviceLabel: 'Samsung TV browser' });
    expect(approve(tv.userCode, user, t0 + 8000, 'Living room')).toEqual({ status: 'approved', deviceLabel: 'Living room', signedOutLabel: null });

    const first = pollPairing(tv.deviceToken, t0 + 10_000);
    const again = pollPairing(tv.deviceToken, t0 + 10_001);
    expect(first).toMatchObject({ status: 'approved', identity: { userId: user.userId, namespaceId: user.namespaceId } });
    expect(again).toEqual(first);
    expect(listDeviceGrants(user.userId, t0 + 10_000)).toHaveLength(1);
    expect(pollPairing(tv.deviceToken, t0 + 11 * 60 * 1000)).toEqual({ status: 'expired' });
  });

  it('refuses an unknown device token and a superseded code', () => {
    const user = newUser();
    const first = start();
    const second = start(Date.now(), first.deviceToken);
    expect(pollPairing('not-a-token')).toEqual({ status: 'expired' });
    expect(pollPairing(first.deviceToken)).toEqual({ status: 'expired' });
    expect(approve(first.userCode, user)).toEqual({ status: 'invalid_code' });
    expect(approve(second.userCode, user).status).toBe('approved');
  });

  it('refuses a realm the approver is not a member of and leaves the code usable', () => {
    const user = newUser();
    const other = newUser();
    const tv = start();
    expect(approve(tv.userCode, { userId: user.userId, namespaceId: other.namespaceId })).toEqual({ status: 'not_member' });
    expect(approve(tv.userCode, user).status).toBe('approved');
  });

  it('approves or denies a code once', () => {
    const user = newUser();
    const approved = start();
    expect(approve(approved.userCode, user).status).toBe('approved');
    expect(approve(approved.userCode, user)).toEqual({ status: 'invalid_code' });
    expect(denyPairing(approved.userCode, user.userId, nextIp())).toEqual({ status: 'invalid_code' });

    const denied = start();
    expect(denyPairing(denied.userCode, user.userId, nextIp())).toEqual({ status: 'denied' });
    expect(pollPairing(denied.deviceToken)).toEqual({ status: 'denied' });
    expect(approve(denied.userCode, user)).toEqual({ status: 'invalid_code' });
  });

  it('signs out the oldest TV when a sixth is approved, and says which one', () => {
    const user = newUser();
    const t0 = Date.now();
    for (let i = 1; i <= 5; i++) {
      expect(approve(start(t0 + i).userCode, user, t0 + i, `TV ${i}`).status).toBe('approved');
    }
    expect(approve(start(t0 + 6).userCode, user, t0 + 6, 'TV 6')).toEqual({ status: 'approved', deviceLabel: 'TV 6', signedOutLabel: 'TV 1' });
    expect(listDeviceGrants(user.userId, t0 + 7).map(grant => grant.label)).toEqual(['TV 2', 'TV 3', 'TV 4', 'TV 5', 'TV 6']);
    const notice = getDb().prepare("SELECT text_body FROM email_outbox WHERE event_key LIKE 'device-signin:%' ORDER BY id DESC LIMIT 1").get() as { text_body: string };
    expect(notice.text_body).toContain('"TV 6"');
    expect(notice.text_body).toContain('"TV 1" was signed out');
  });

  it('rate limits code checks per user', () => {
    const user = newUser();
    const now = Date.now();
    const results = Array.from({ length: 11 }, () => lookupPairing('BCDF-GHJK', user.userId, nextIp(), now));
    expect(results[9]).toEqual({ status: 'invalid_code' });
    expect(results[10]).toMatchObject({ status: 'rate_limited' });
  });
});

describe('grants', () => {
  const pairedTv = (now = Date.now()) => {
    const user = newUser();
    const tv = start(now);
    approve(tv.userCode, user, now);
    const poll = pollPairing(tv.deviceToken, now);
    if (poll.status !== 'approved') {
      throw new Error('not approved');
    }
    return { user, grantId: poll.identity.grantId };
  };

  it('ends after 30 days unused and after 60 days even when used', () => {
    const t0 = Date.now();
    const idle = pairedTv(t0);
    expect(checkDeviceGrant(idle.grantId, idle.user.userId, idle.user.namespaceId, t0 + DAY_MS)).toMatchObject({ ok: true });
    expect(checkDeviceGrant(idle.grantId, idle.user.userId, idle.user.namespaceId, t0 + 32 * DAY_MS)).toEqual({ ok: false });
    expect(devicePairingRepository.getGrant(idle.grantId)?.revoked_reason).toBe('idle');

    const used = pairedTv(t0);
    for (let day = 20; day < 60; day += 20) {
      expect(checkDeviceGrant(used.grantId, used.user.userId, used.user.namespaceId, t0 + day * DAY_MS).ok).toBe(true);
    }
    expect(checkDeviceGrant(used.grantId, used.user.userId, used.user.namespaceId, t0 + 61 * DAY_MS)).toEqual({ ok: false });
    expect(devicePairingRepository.getGrant(used.grantId)?.revoked_reason).toBe('max-age');
  });

  it('rejects another user, another realm, and a revoked grant', () => {
    const { user, grantId } = pairedTv();
    const other = newUser();
    expect(checkDeviceGrant(grantId, other.userId, user.namespaceId).ok).toBe(false);
    expect(checkDeviceGrant(grantId, user.userId, other.namespaceId).ok).toBe(false);
    expect(revokeDeviceGrant(grantId, other.userId, 'user')).toBe(false);
    expect(revokeDeviceGrant(grantId, user.userId, 'user')).toBe(true);
    expect(checkDeviceGrant(grantId, user.userId, user.namespaceId).ok).toBe(false);
  });

  it('kill switch rejects without revoking', () => {
    const { user, grantId } = pairedTv();
    process.env.DEVICE_SIGN_IN_DISABLED = 'true';
    resetConfigForTests();
    expect(checkDeviceGrant(grantId, user.userId, user.namespaceId).ok).toBe(false);
    delete process.env.DEVICE_SIGN_IN_DISABLED;
    resetConfigForTests();
    expect(checkDeviceGrant(grantId, user.userId, user.namespaceId).ok).toBe(true);
  });

  it('revokes a grant the TV never claimed once the pairing expires', () => {
    const user = newUser();
    const t0 = Date.now();
    const tv = start(t0);
    approve(tv.userCode, user, t0);
    const [grant] = listDeviceGrants(user.userId, t0);
    runDeviceMaintenance(t0 + 11 * 60 * 1000);
    expect(devicePairingRepository.getGrant(grant.id)?.revoked_reason).toBe('unclaimed');
  });
});
