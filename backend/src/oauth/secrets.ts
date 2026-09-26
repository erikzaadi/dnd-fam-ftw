import crypto from 'crypto';

// Opaque OAuth secrets: 256 random bits with a readable prefix. Only the SHA-256
// digest is stored, so a database leak does not leak usable credentials.
export const newSecret = (prefix: string): string => `${prefix}${crypto.randomBytes(32).toString('base64url')}`;

export const digestSecret = (secret: string): string => crypto.createHash('sha256').update(secret).digest('hex');

// PKCE S256 (RFC 7636): BASE64URL(SHA256(verifier)) must equal the stored challenge.
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
export const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const verifyPkce = (verifier: string | undefined, challenge: string): boolean => {
  if (!verifier || !VERIFIER_PATTERN.test(verifier)) {
    return false;
  }
  const computed = Buffer.from(crypto.createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
};
