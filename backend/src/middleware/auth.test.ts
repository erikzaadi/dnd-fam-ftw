import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isAuthEnabled } from '../config/env.js';
import { userRepository } from '../repositories/userRepository.js';
import { authMiddleware } from './auth.js';

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

const authenticate = (token?: string) => {
  const req = { cookies: token ? { jwt: token } : {} } as Request;
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  const res = { status, json } as unknown as Response;
  const next = vi.fn();
  authMiddleware(req, res, next);
  return { req, status, json, next };
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

  it('preserves explicitly auth-disabled local behavior without querying users', () => {
    vi.mocked(isAuthEnabled).mockReturnValue(false);
    const result = authenticate();
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.req.namespaceId).toBe('local');
    expect(result.req.userEmail).toBeNull();
    expect(userRepository.getUserByEmail).not.toHaveBeenCalled();
    expect(userRepository.getUserNamespaces).not.toHaveBeenCalled();
  });
});
