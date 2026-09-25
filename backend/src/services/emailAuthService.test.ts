import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { CaptureEmailProvider } from '../providers/email/CaptureEmailProvider.js';
import { setEmailProviderForTests } from '../providers/email/emailProviderFactory.js';
import { userRepository } from '../repositories/userRepository.js';
import { resendEmailCode, startEmailSignIn, verifyEmailCode } from './emailAuthService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-email-auth-test-${Date.now()}.sqlite`);
let mail: CaptureEmailProvider;
let ipCounter = 0;
// A fresh client address per test keeps per-IP rate limits out of unrelated tests.
const nextIp = () => `10.0.0.${++ipCounter}`;

const lastCode = (): string => {
  const match = mail.sent[mail.sent.length - 1]?.text.match(/code is: (\d{8})/);
  if (!match) {
    throw new Error('No code sent');
  }
  return match[1];
};

const start = async (email: string, ip = nextIp()) => {
  const result = await startEmailSignIn(email, ip);
  if (result.status !== 'sent') {
    throw new Error(`start failed: ${result.status}`);
  }
  return { ...result, code: lastCode(), ip };
};

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.JWT_SECRET = 'email-auth-test-secret-that-is-long-enough';
  process.env.SIGNUP_MODE = 'open';
  process.env.ADMIN_EMAIL = 'owner@example.com';
  initializeDatabase();
});

beforeEach(() => {
  mail = new CaptureEmailProvider();
  setEmailProviderForTests(mail);
  delete process.env.SIGNUP_DAILY_CAP;
});

afterAll(() => {
  setEmailProviderForTests(null);
  fs.rmSync(DB_PATH, { force: true });
});

describe('email sign-in', () => {
  it('rejects malformed addresses without sending mail', async () => {
    expect(await startEmailSignIn('not-an-email', nextIp())).toEqual({ status: 'invalid_email' });
    expect(mail.sent).toHaveLength(0);
  });

  it('creates exactly one free account, namespace, and signup notice for a new address', async () => {
    const { challengeId, browserToken, code, ip } = await start('New.Hero@Example.com');
    expect(mail.sent[0].to).toBe('new.hero@example.com');
    const result = verifyEmailCode(challengeId, code, browserToken, ip);
    expect(result).toMatchObject({ status: 'ok', outcome: { kind: 'full', created: true, email: 'new.hero@example.com' } });

    const user = userRepository.getUserByEmail('NEW.HERO@example.com');
    expect(user?.role).toBe('member');
    const tier = getDb().prepare('SELECT tier FROM namespaces WHERE id = ?').get(user!.namespace_id) as { tier: string };
    expect(tier.tier).toBe('free');
    const notices = getDb().prepare('SELECT * FROM email_outbox WHERE event_key = ?').all(`signup:${user!.id}`);
    expect(notices).toHaveLength(1);
  });

  it('signs an existing user in without creating a namespace or notice', async () => {
    userRepository.createUser('returning@example.com');
    const namespacesBefore = (getDb().prepare('SELECT COUNT(*) AS c FROM namespaces').get() as { c: number }).c;
    const outboxBefore = (getDb().prepare('SELECT COUNT(*) AS c FROM email_outbox').get() as { c: number }).c;
    const { challengeId, browserToken, code, ip } = await start('returning@example.com');
    expect(verifyEmailCode(challengeId, code, browserToken, ip)).toMatchObject({ status: 'ok', outcome: { kind: 'full', created: false } });
    expect((getDb().prepare('SELECT COUNT(*) AS c FROM namespaces').get() as { c: number }).c).toBe(namespacesBefore);
    expect((getDb().prepare('SELECT COUNT(*) AS c FROM email_outbox').get() as { c: number }).c).toBe(outboxBefore);
  });

  it('never lets a code be used twice', async () => {
    const { challengeId, browserToken, code, ip } = await start('replay@example.com');
    expect(verifyEmailCode(challengeId, code, browserToken, ip).status).toBe('ok');
    expect(verifyEmailCode(challengeId, code, browserToken, ip).status).toBe('expired');
  });

  it('refuses the code from a different browser', async () => {
    const { challengeId, code, ip } = await start('binding@example.com');
    expect(verifyEmailCode(challengeId, code, 'another-browser', ip).status).toBe('expired');
    expect(userRepository.getUserByEmail('binding@example.com')).toBeNull();
  });

  it('locks the challenge after too many wrong codes', async () => {
    const { challengeId, browserToken, code, ip } = await start('guess@example.com');
    for (let i = 0; i < 5; i++) {
      expect(verifyEmailCode(challengeId, '00000000', browserToken, ip).status).toBe(code === '00000000' ? 'ok' : 'invalid_code');
    }
    expect(verifyEmailCode(challengeId, code, browserToken, ip).status).toBe('expired');
  });

  it('only accepts the newest code after starting again', async () => {
    const first = await start('newest@example.com');
    const second = await start('newest@example.com');
    expect(verifyEmailCode(first.challengeId, first.code, first.browserToken, first.ip).status).toBe('expired');
    expect(verifyEmailCode(second.challengeId, second.code, second.browserToken, second.ip).status).toBe('ok');
  });

  it('enforces the resend interval, and a resent code replaces the old one', async () => {
    const { challengeId, browserToken, code, ip } = await start('resend@example.com');
    expect((await resendEmailCode(challengeId, browserToken, ip)).status).toBe('rate_limited');
    const later = Date.now() + 61 * 1000;
    expect((await resendEmailCode(challengeId, browserToken, ip, later)).status).toBe('sent');
    const newCode = lastCode();
    if (newCode !== code) {
      expect(verifyEmailCode(challengeId, code, browserToken, ip, later).status).toBe('invalid_code');
    }
    expect(verifyEmailCode(challengeId, newCode, browserToken, ip, later).status).toBe('ok');
  });

  it('falls back to the invite flow when new accounts cannot be created', async () => {
    process.env.SIGNUP_DAILY_CAP = '0';
    const { challengeId, browserToken, code, ip } = await start('capped@example.com');
    expect(verifyEmailCode(challengeId, code, browserToken, ip)).toMatchObject({ status: 'ok', outcome: { kind: 'invite' } });
    expect(userRepository.getUserByEmail('capped@example.com')).toBeNull();
  });

  it('rate limits sends per address', async () => {
    const statuses: string[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await startEmailSignIn('spam@example.com', nextIp())).status);
    }
    expect(statuses.slice(0, 5).every(status => status === 'sent')).toBe(true);
    expect(statuses[5]).toBe('rate_limited');
  });

  it('invalidates the challenge when the code cannot be sent', async () => {
    setEmailProviderForTests({
      send: async () => {
        throw new Error('mail down');
      },
    });
    expect(await startEmailSignIn('outage@example.com', nextIp())).toEqual({ status: 'unavailable' });
  });
});
