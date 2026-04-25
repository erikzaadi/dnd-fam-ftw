import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { signJwt, verifyJwt, buildGoogleAuthUrl, getAuthPublicConfig } from './authService.js';

const JWT_SECRET = 'test-jwt-secret-for-auth-tests-only';

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  process.env.GOOGLE_CALLBACK_URL = 'http://localhost:5173/api/auth/google/callback';
});

describe('authService', () => {
  it('signJwt + verifyJwt round-trip preserves email and namespaceId', () => {
    const token = signJwt({ email: 'hero@example.com', namespaceId: 'ns-1' });
    const payload = verifyJwt(token);
    expect(payload).not.toBeNull();
    expect(payload!.email).toBe('hero@example.com');
    expect(payload!.namespaceId).toBe('ns-1');
  });

  it('preserves optional type field in JWT', () => {
    const token = signJwt({ email: 'new@example.com', namespaceId: 'ns-2', type: 'pending-namespace' });
    const payload = verifyJwt(token);
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe('pending-namespace');
  });

  it('verifyJwt returns null for garbage token', () => {
    expect(verifyJwt('this.is.not.a.jwt')).toBeNull();
  });

  it('verifyJwt returns null for token signed with wrong secret', () => {
    const token = jwt.sign({ email: 'hacker@evil.com', namespaceId: 'ns-hacked' }, 'totally-different-secret');
    expect(verifyJwt(token)).toBeNull();
  });

  it('verifyJwt returns null for expired token', () => {
    const token = jwt.sign({ email: 'old@example.com', namespaceId: 'ns-old' }, JWT_SECRET, { expiresIn: -1 });
    expect(verifyJwt(token)).toBeNull();
  });

  it('short-lived token is verifiable immediately after signing', () => {
    const token = signJwt({ email: 'temp@example.com', namespaceId: 'ns-temp' }, true);
    const payload = verifyJwt(token);
    expect(payload).not.toBeNull();
    expect(payload!.email).toBe('temp@example.com');
  });

  it('buildGoogleAuthUrl contains required query params', () => {
    const authUrl = buildGoogleAuthUrl('csrf-state-token-123');
    const parsed = new URL(authUrl);
    expect(parsed.hostname).toBe('accounts.google.com');
    expect(parsed.searchParams.get('client_id')).toBe('test-google-client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/auth/google/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('state')).toBe('csrf-state-token-123');
    expect(parsed.searchParams.get('scope')).toContain('email');
  });

  it('getAuthPublicConfig returns enabled=true when keys are set', () => {
    const config = getAuthPublicConfig();
    expect(config.enabled).toBe(true);
    expect(config.googleClientId).toBe('test-google-client-id');
  });

  it('all JWT types sign and verify correctly', () => {
    const types = ['full', 'pending-namespace', 'pending-invite', 'invite-requested'] as const;
    for (const type of types) {
      const token = signJwt({ email: `${type}@test.com`, namespaceId: 'ns-type', type });
      const payload = verifyJwt(token);
      expect(payload).not.toBeNull();
      expect(payload!.type).toBe(type);
    }
  });
});
