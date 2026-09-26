import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isAuthEnabled } from '../config/env.js';
import { userRepository } from '../repositories/userRepository.js';
import { authMiddleware, requireFullIdentity } from './auth.js';

vi.mock('../config/env.js', () => ({
  isAuthEnabled: vi.fn(() => true),
  getConfig: () => ({ JWT_SECRET: 'middleware-auth-test-secret' }),
}));

vi.mock('../repositories/userRepository.js', () => ({
  userRepository: {
    getUserByEmail: vi.fn(),
    getUserById: vi.fn(),
    getUserCreatedAt: vi.fn(),
    getUserNamespaces: vi.fn(),
  },
}));

const fullPayload = { type: 'full', email: 'hero@example.com', namespaceId: 'ns-primary' };
const sign = (payload: object) => jwt.sign(payload, 'middleware-auth-test-secret');

const authenticate = (token?: string, headers: Record<string, string> = {}, middleware = authMiddleware) => {
  const req = {
    cookies: token ? { jwt: token } : {},
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  const cookie = vi.fn();
  const res = { status, json, cookie } as unknown as Response;
  const next = vi.fn();
  middleware(req, res, next);
  return { req, status, json, cookie, next };
};

const expectRejected = (result: ReturnType<typeof authenticate>) => {
  expect(result.status).toHaveBeenCalledWith(401);
  expect(result.next).not.toHaveBeenCalled();
  expect(result.req.namespaceId).toBeUndefined();
  expect(result.req.userEmail).toBeUndefined();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAuthEnabled).mockReturnValue(true);
  vi.mocked(userRepository.getUserByEmail).mockReturnValue({
    id: 'user-1', email: fullPayload.email, namespace_id: 'ns-primary', role: 'member',
  });
  vi.mocked(userRepository.getUserCreatedAt).mockReturnValue('2020-01-01 00:00:00');
  vi.mocked(userRepository.getUserById).mockReturnValue({
    id: 'user-1', email: fullPayload.email, namespace_id: 'ns-primary', role: 'member', created_at: '2020-01-01 00:00:00',
  });
  vi.mocked(userRepository.getUserNamespaces).mockReturnValue([
    { id: 'ns-primary', name: 'Primary' },
    { id: 'ns-shared', name: 'Shared' },
  ]);
});

describe('authMiddleware', () => {
  it.each(['pending-invite', 'invite-requested', 'pending-namespace'])('rejects a signed %s token copied into the full-session cookie', type => {
    expectRejected(authenticate(sign({ ...fullPayload, type, namespaceId: '' })));
    // A valid member/namespace does not turn a pending token into a full token.
    expectRejected(authenticate(sign({ ...fullPayload, type })));
    expect(userRepository.getUserByEmail).not.toHaveBeenCalled();
  });

  it.each([
    { ...fullPayload, type: undefined },
    { ...fullPayload, type: 'unknown' },
    { ...fullPayload, namespaceId: '' },
    { ...fullPayload, namespaceId: '  ' },
    { ...fullPayload, namespaceId: undefined },
    { ...fullPayload, namespaceId: 42 },
    { ...fullPayload, email: '' },
    { ...fullPayload, email: '  ' },
    { ...fullPayload, email: undefined },
    { ...fullPayload, email: 42 },
  ])('rejects malformed or legacy full-session claims: %j', payload => {
    expectRejected(authenticate(sign(payload)));
    expect(userRepository.getUserByEmail).not.toHaveBeenCalled();
  });

  it('rejects missing, invalid, expired, and wrong-signature tokens', () => {
    for (const token of [
      undefined,
      'invalid',
      jwt.sign(fullPayload, 'middleware-auth-test-secret', { expiresIn: -1 }),
      jwt.sign(fullPayload, 'wrong-secret'),
    ]) {
      expectRejected(authenticate(token));
    }
    expect(userRepository.getUserByEmail).not.toHaveBeenCalled();
  });

  it('rejects a previously working token after the user is deleted', () => {
    const token = sign(fullPayload);
    expect(authenticate(token).next).toHaveBeenCalledOnce();
    vi.mocked(userRepository.getUserByEmail).mockReturnValue(null);
    expectRejected(authenticate(token));
  });

  it('rejects a previously working token after namespace membership is removed', () => {
    const token = sign(fullPayload);
    expect(authenticate(token).next).toHaveBeenCalledOnce();
    vi.mocked(userRepository.getUserNamespaces).mockReturnValue([{ id: 'ns-shared', name: 'Shared' }]);
    // The primary-namespace column alone is not evidence of current membership.
    expectRejected(authenticate(token));
  });

  it('rejects an unknown namespace even for an existing member', () => {
    expectRejected(authenticate(sign({ ...fullPayload, namespaceId: 'missing' })));
  });

  it.each(['ns-primary', 'ns-shared'])('allows a full session for current membership in %s', namespaceId => {
    const result = authenticate(sign({ ...fullPayload, namespaceId }));
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.status).not.toHaveBeenCalled();
    expect(result.req.namespaceId).toBe(namespaceId);
    expect(result.req.userEmail).toBe(fullPayload.email);
    expect(userRepository.getUserByEmail).toHaveBeenCalledWith(fullPayload.email);
    expect(userRepository.getUserNamespaces).toHaveBeenCalledWith(fullPayload.email);
  });

  it('allows a full session bound to the current user id', () => {
    const result = authenticate(sign({ ...fullPayload, userId: 'user-1' }));
    expect(result.next).toHaveBeenCalledOnce();
    expect(userRepository.getUserById).toHaveBeenCalledWith('user-1');
    expect(userRepository.getUserByEmail).not.toHaveBeenCalled();
  });

  it('rejects a user-id token whose account was deleted, even if the email was re-registered', () => {
    vi.mocked(userRepository.getUserById).mockReturnValue(null);
    expectRejected(authenticate(sign({ ...fullPayload, userId: 'user-deleted' })));
  });

  it('rejects a user-id token whose email no longer matches the account', () => {
    expectRejected(authenticate(sign({ ...fullPayload, email: 'other@example.com', userId: 'user-1' })));
  });

  it.each([123, ''])('rejects a malformed userId claim %j', userId => {
    expectRejected(authenticate(sign({ ...fullPayload, userId })));
  });

  it('rejects a legacy email-only token issued before the account was created', () => {
    vi.mocked(userRepository.getUserCreatedAt).mockReturnValue('2999-01-01 00:00:00');
    expectRejected(authenticate(sign(fullPayload)));
  });

  it('refreshes a session with less than a week left, bound to the user id', () => {
    const exp = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60;
    const result = authenticate(sign({ ...fullPayload, exp }));
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.cookie).toHaveBeenCalledOnce();
    const [name, token] = result.cookie.mock.calls[0] as [string, string];
    expect(name).toBe('jwt');
    const refreshed = jwt.verify(token, 'middleware-auth-test-secret') as { userId: string; exp: number };
    expect(refreshed.userId).toBe('user-1');
    expect(refreshed.exp).toBeGreaterThan(exp);
  });

  it('does not refresh a session with more than a week left', () => {
    const exp = Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60;
    expect(authenticate(sign({ ...fullPayload, exp })).cookie).not.toHaveBeenCalled();
  });

  it('preserves explicitly auth-disabled local behavior without querying users', () => {
    vi.mocked(isAuthEnabled).mockReturnValue(false);
    const result = authenticate();
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.req.namespaceId).toBe('local');
    expect(result.req.userEmail).toBeNull();
    expect(userRepository.getUserByEmail).not.toHaveBeenCalled();
    expect(userRepository.getUserNamespaces).not.toHaveBeenCalled();
  });

  it('marks a lost membership so the client can recover without signing in again', () => {
    vi.mocked(userRepository.getUserNamespaces).mockReturnValue([{ id: 'ns-shared', name: 'Shared' }]);
    const result = authenticate(sign(fullPayload));
    expectRejected(result);
    expect(result.json).toHaveBeenCalledWith({ error: 'Invalid or expired session', code: 'namespace_access_lost' });
  });

  it('accepts a matching expected-namespace header', () => {
    const result = authenticate(sign(fullPayload), { 'x-namespace-id': 'ns-primary' });
    expect(result.next).toHaveBeenCalledOnce();
  });

  it('rejects a stale tab whose expected namespace no longer matches the cookie', () => {
    const result = authenticate(sign(fullPayload), { 'x-namespace-id': 'ns-shared' });
    expect(result.status).toHaveBeenCalledWith(409);
    expect(result.json).toHaveBeenCalledWith({ error: 'namespace_changed' });
    expect(result.next).not.toHaveBeenCalled();
    expect(result.req.namespaceId).toBeUndefined();
  });
});

describe('requireFullIdentity', () => {
  it('accepts a valid sign-in whose namespace membership was removed', () => {
    vi.mocked(userRepository.getUserNamespaces).mockReturnValue([{ id: 'ns-shared', name: 'Shared' }]);
    const result = authenticate(sign({ ...fullPayload, userId: 'user-1' }), {}, requireFullIdentity);
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.req.fullIdentity).toMatchObject({ userId: 'user-1', email: fullPayload.email, namespaceId: 'ns-primary' });
    expect(result.req.namespaceId).toBeUndefined();
  });

  it.each(['pending-invite', 'invite-requested', 'pending-namespace'])('rejects a %s token', type => {
    const result = authenticate(sign({ ...fullPayload, type }), {}, requireFullIdentity);
    expect(result.status).toHaveBeenCalledWith(401);
    expect(result.next).not.toHaveBeenCalled();
  });

  it('rejects a token for a deleted account', () => {
    vi.mocked(userRepository.getUserById).mockReturnValue(null);
    const result = authenticate(sign({ ...fullPayload, userId: 'user-1' }), {}, requireFullIdentity);
    expect(result.status).toHaveBeenCalledWith(401);
    expect(result.next).not.toHaveBeenCalled();
  });
});
