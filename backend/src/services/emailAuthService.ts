import crypto from 'crypto';
import { getConfig } from '../config/env.js';
import { maskEmail, parseEmailAddress } from '../lib/email.js';
import { getDb } from '../persistence/database.js';
import { authChallengeRepository } from '../repositories/authChallengeRepository.js';
import { getEmailProvider } from '../providers/email/emailProviderFactory.js';
import { buildSignInCodeEmail } from './emailService.js';
import { resolveVerifiedSignIn, type SignInOutcome } from './signupService.js';
import { safeEqual } from './authService.js';

const CODE_DIGITS = 8;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const RESEND_INTERVAL_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const SENDS_PER_ADDRESS_PER_HOUR = 5;
const SENDS_PER_IP_PER_HOUR = 20;
const VERIFIES_PER_IP_PER_TEN_MINUTES = 30;
// Expired challenges and old rate-limit windows are kept this long, then deleted.
const RETENTION_MS = 24 * HOUR_MS;

export type StartResult =
  | { status: 'sent'; challengeId: string; browserToken: string; maskedEmail: string; resendAfterSeconds: number; expiresInSeconds: number }
  | { status: 'invalid_email' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'unavailable' };

export type VerifyResult =
  | { status: 'ok'; outcome: SignInOutcome }
  | { status: 'invalid_code'; attemptsLeft: number }
  // Wrong browser, unknown, expired, superseded, consumed, or out of attempts.
  | { status: 'expired' }
  | { status: 'rate_limited'; retryAfterSeconds: number };

export type ResendResult =
  | { status: 'sent'; resendAfterSeconds: number; expiresInSeconds: number }
  | { status: 'expired' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'unavailable' };

let hmacKey: Buffer | null = null;

function getHmacKey(): Buffer {
  if (!hmacKey) {
    const config = getConfig();
    hmacKey = config.EMAIL_CODE_HMAC_SECRET
      ? Buffer.from(config.EMAIL_CODE_HMAC_SECRET)
      // Domain-separated from JWT signing when no dedicated secret is configured.
      : crypto.createHmac('sha256', config.JWT_SECRET ?? '').update('email-sign-in-code').digest();
  }
  return hmacKey;
}

// A short code alone is easy to brute-force offline, so it is keyed and bound to its challenge.
const codeHmac = (challengeId: string, code: string): string =>
  crypto.createHmac('sha256', getHmacKey()).update(`${challengeId}:${code}`).digest('hex');

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

const generateCode = (): string => String(crypto.randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');

// Accepts pasted codes with spaces or dashes.
const normalizeCode = (code: unknown): string | null => {
  if (typeof code !== 'string') {
    return null;
  }
  const digits = code.replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${CODE_DIGITS}}$`).test(digits) ? digits : null;
};

function hitRateLimit(bucket: string, windowMs: number, limit: number, now: number): number | null {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const count = authChallengeRepository.incrementRateLimit(bucket, windowStart);
  return count > limit ? Math.ceil((windowStart + windowMs - now) / 1000) : null;
}

async function sendCode(email: string, code: string): Promise<boolean> {
  const provider = getEmailProvider();
  if (!provider) {
    return false;
  }
  try {
    await provider.send(buildSignInCodeEmail(email, code, CODE_TTL_MS / 60000));
    return true;
  } catch (err) {
    console.warn(`[Auth] Sending sign-in code failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// Same response shape whether or not an account exists for the address.
export async function startEmailSignIn(rawEmail: unknown, ip: string, now: number = Date.now()): Promise<StartResult> {
  const email = parseEmailAddress(rawEmail);
  if (!email) {
    return { status: 'invalid_email' };
  }
  const ipLimited = hitRateLimit(`send:ip:${ip}`, HOUR_MS, SENDS_PER_IP_PER_HOUR, now);
  const addressLimited = hitRateLimit(`send:email:${email}`, HOUR_MS, SENDS_PER_ADDRESS_PER_HOUR, now);
  if (ipLimited !== null || addressLimited !== null) {
    return { status: 'rate_limited', retryAfterSeconds: Math.max(ipLimited ?? 0, addressLimited ?? 0) };
  }

  const challengeId = crypto.randomBytes(18).toString('base64url');
  const browserToken = crypto.randomBytes(32).toString('base64url');
  const code = generateCode();
  authChallengeRepository.createChallenge({
    id: challengeId,
    email_canonical: email,
    code_hmac: codeHmac(challengeId, code),
    browser_hash: sha256(browserToken),
    created_at: now,
    last_sent_at: now,
    expires_at: now + CODE_TTL_MS,
  });
  if (!(await sendCode(email, code))) {
    authChallengeRepository.invalidateChallenge(challengeId, Date.now());
    return { status: 'unavailable' };
  }
  return {
    status: 'sent',
    challengeId,
    browserToken,
    maskedEmail: maskEmail(email),
    resendAfterSeconds: RESEND_INTERVAL_MS / 1000,
    expiresInSeconds: CODE_TTL_MS / 1000,
  };
}

export function verifyEmailCode(challengeId: unknown, rawCode: unknown, browserToken: string | undefined, ip: string, now: number = Date.now()): VerifyResult {
  const ipLimited = hitRateLimit(`verify:ip:${ip}`, TEN_MINUTES_MS, VERIFIES_PER_IP_PER_TEN_MINUTES, now);
  if (ipLimited !== null) {
    return { status: 'rate_limited', retryAfterSeconds: ipLimited };
  }
  if (typeof challengeId !== 'string' || !browserToken) {
    return { status: 'expired' };
  }
  const challenge = authChallengeRepository.getChallenge(challengeId);
  if (!challenge || !safeEqual(challenge.browser_hash, sha256(browserToken))) {
    return { status: 'expired' };
  }
  // Malformed codes still use up an attempt.
  if (!authChallengeRepository.recordAttempt(challengeId, MAX_VERIFY_ATTEMPTS, now)) {
    return { status: 'expired' };
  }
  const code = normalizeCode(rawCode);
  if (!code || !safeEqual(challenge.code_hmac, codeHmac(challengeId, code))) {
    return { status: 'invalid_code', attemptsLeft: Math.max(0, MAX_VERIFY_ATTEMPTS - challenge.attempts - 1) };
  }

  // Consuming the code and creating the account commit together or not at all.
  const db = getDb();
  const outcome = db.transaction((): SignInOutcome | null => {
    if (!authChallengeRepository.consumeChallenge(challengeId, now)) {
      return null;
    }
    return resolveVerifiedSignIn(challenge.email_canonical, 'email', new Date(now));
  })();
  return outcome ? { status: 'ok', outcome } : { status: 'expired' };
}

export async function resendEmailCode(challengeId: unknown, browserToken: string | undefined, ip: string, now: number = Date.now()): Promise<ResendResult> {
  if (typeof challengeId !== 'string' || !browserToken) {
    return { status: 'expired' };
  }
  const challenge = authChallengeRepository.getChallenge(challengeId);
  if (!challenge || !safeEqual(challenge.browser_hash, sha256(browserToken))
    || challenge.consumed_at !== null || challenge.superseded_at !== null) {
    return { status: 'expired' };
  }
  const waitMs = challenge.last_sent_at + RESEND_INTERVAL_MS - now;
  if (waitMs > 0) {
    return { status: 'rate_limited', retryAfterSeconds: Math.ceil(waitMs / 1000) };
  }
  const ipLimited = hitRateLimit(`send:ip:${ip}`, HOUR_MS, SENDS_PER_IP_PER_HOUR, now);
  const addressLimited = hitRateLimit(`send:email:${challenge.email_canonical}`, HOUR_MS, SENDS_PER_ADDRESS_PER_HOUR, now);
  if (ipLimited !== null || addressLimited !== null) {
    return { status: 'rate_limited', retryAfterSeconds: Math.max(ipLimited ?? 0, addressLimited ?? 0) };
  }
  // The attempt budget is not reset by a resend.
  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { status: 'expired' };
  }
  const code = generateCode();
  if (!authChallengeRepository.rotateCode(challengeId, codeHmac(challengeId, code), now, now + CODE_TTL_MS)) {
    return { status: 'expired' };
  }
  if (!(await sendCode(challenge.email_canonical, code))) {
    authChallengeRepository.invalidateChallenge(challengeId, Date.now());
    return { status: 'unavailable' };
  }
  return { status: 'sent', resendAfterSeconds: RESEND_INTERVAL_MS / 1000, expiresInSeconds: CODE_TTL_MS / 1000 };
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startEmailAuthMaintenance(): void {
  if (cleanupTimer) {
    return;
  }
  const cleanup = () => {
    try {
      authChallengeRepository.deleteExpired(Date.now() - RETENTION_MS);
    } catch (err) {
      console.warn(`[Auth] Challenge cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  cleanup();
  cleanupTimer = setInterval(cleanup, HOUR_MS);
  cleanupTimer.unref();
}
