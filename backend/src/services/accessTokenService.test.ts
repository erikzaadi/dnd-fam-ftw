import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { userRepository } from '../repositories/userRepository.js';
import { accessTokenService, MAX_ACTIVE_TOKENS_PER_USER, TOKEN_LIFETIME_MS } from './accessTokenService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-access-tokens-test-${Date.now()}.sqlite`);

let seq = 0;
const pilotUser = (email = `hero${++seq}@example.com`) => {
  const { userId, namespaceId } = userRepository.createUser(email);
  userRepository.setMcpAccess(userId, true);
  return { userId, namespaceId, email };
};

const mint = (userId: string, namespaceId: string, now?: number) => {
  const result = accessTokenService.create({ userId, namespaceId, label: 'Laptop', scopes: ['adventures:play'], now });
  if (!result.ok) {
    throw new Error(`mint failed: ${result.error}`);
  }
  return result;
};

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.AUTH_MODE = 'enabled';
  process.env.JWT_SECRET = 'access-token-test-secret-that-is-long-enough';
  process.env.MCP_ENABLED = 'true';
  initializeDatabase();
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

describe('accessTokenService', () => {
  it('refuses users outside the pilot allowlist', () => {
    const { userId, namespaceId } = userRepository.createUser('outsider@example.com');
    expect(accessTokenService.create({ userId, namespaceId, label: 'x', scopes: [] })).toEqual({ ok: false, error: 'not_eligible' });
  });

  it('refuses a namespace the user is not a member of', () => {
    const a = pilotUser();
    const b = pilotUser();
    expect(accessTokenService.create({ userId: a.userId, namespaceId: b.namespaceId, label: 'x', scopes: [] })).toEqual({ ok: false, error: 'not_member' });
  });

  it('stores only a digest and authenticates the secret to the granted namespace', () => {
    const { userId, namespaceId, email } = pilotUser();
    const { secret, token } = mint(userId, namespaceId);
    expect(secret).toMatch(/^dndmcp_[A-Za-z0-9_-]{43}$/);
    expect(token.prefix).toBe(secret.slice(0, token.prefix.length));
    expect(token).not.toHaveProperty('token_digest');
    const row = getDb().prepare('SELECT * FROM access_tokens WHERE id = ?').get(token.id) as Record<string, unknown>;
    expect(Object.values(row)).not.toContain(secret);

    const principal = accessTokenService.authenticate(secret);
    expect(principal).toMatchObject({ tokenId: token.id, userId, email, namespaceId });
    // Read is always granted; create was not requested.
    expect(principal?.scopes).toEqual(['adventures:read', 'adventures:play']);
  });

  it('rejects unknown, malformed, and tampered secrets', () => {
    const { userId, namespaceId } = pilotUser();
    const { secret } = mint(userId, namespaceId);
    expect(accessTokenService.authenticate('')).toBeNull();
    expect(accessTokenService.authenticate('not-a-token')).toBeNull();
    expect(accessTokenService.authenticate(`${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`)).toBeNull();
  });

  it(`allows at most ${MAX_ACTIVE_TOKENS_PER_USER} active tokens per user`, () => {
    const { userId, namespaceId } = pilotUser();
    const tokens = Array.from({ length: MAX_ACTIVE_TOKENS_PER_USER }, () => mint(userId, namespaceId));
    expect(accessTokenService.create({ userId, namespaceId, label: 'one more', scopes: [] })).toEqual({ ok: false, error: 'too_many_tokens' });
    accessTokenService.revoke(userId, tokens[0].token.id);
    expect(accessTokenService.create({ userId, namespaceId, label: 'one more', scopes: [] }).ok).toBe(true);
  });

  it('stops authenticating after expiry or revocation', () => {
    const { userId, namespaceId } = pilotUser();
    const now = Date.now();
    const expiring = mint(userId, namespaceId, now);
    expect(accessTokenService.authenticate(expiring.secret, now + TOKEN_LIFETIME_MS - 1)).not.toBeNull();
    expect(accessTokenService.authenticate(expiring.secret, now + TOKEN_LIFETIME_MS)).toBeNull();

    const revoked = mint(userId, namespaceId);
    expect(accessTokenService.revoke(userId, revoked.token.id)).toBe(true);
    expect(accessTokenService.authenticate(revoked.secret)).toBeNull();
    expect(accessTokenService.revoke(userId, revoked.token.id)).toBe(false);
  });

  it('only lets the owner revoke a token', () => {
    const owner = pilotUser();
    const other = pilotUser();
    const { secret, token } = mint(owner.userId, owner.namespaceId);
    expect(accessTokenService.revoke(other.userId, token.id)).toBe(false);
    expect(accessTokenService.authenticate(secret)).not.toBeNull();
  });

  it('stops authenticating when pilot access or namespace membership is removed', () => {
    const { userId, namespaceId } = pilotUser();
    const { secret } = mint(userId, namespaceId);
    userRepository.setMcpAccess(userId, false);
    expect(accessTokenService.authenticate(secret)).toBeNull();
    userRepository.setMcpAccess(userId, true);
    expect(accessTokenService.authenticate(secret)).not.toBeNull();
    userRepository.removeUserFromNamespace(userId, namespaceId);
    expect(accessTokenService.authenticate(secret)).toBeNull();
  });

  it('removes tokens with the user, and a recreated account never inherits them', () => {
    const email = 'replaced@example.com';
    const first = pilotUser(email);
    const { secret } = mint(first.userId, first.namespaceId);
    userRepository.deleteUser(email);
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM access_tokens WHERE user_id = ?').get(first.userId)).toMatchObject({ count: 0 });
    pilotUser(email);
    expect(accessTokenService.authenticate(secret)).toBeNull();
  });

  it('rotates by issuing a replacement and revoking the old token', () => {
    const { userId, namespaceId } = pilotUser();
    const old = mint(userId, namespaceId);
    const rotated = accessTokenService.rotate(userId, old.token.id);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) {
      return;
    }
    expect(rotated.token.id).not.toBe(old.token.id);
    expect(rotated.token.label).toBe(old.token.label);
    expect(rotated.token.scopes).toEqual(old.token.scopes);
    expect(accessTokenService.authenticate(old.secret)).toBeNull();
    expect(accessTokenService.authenticate(rotated.secret)).toMatchObject({ tokenId: rotated.token.id, namespaceId });
    expect(accessTokenService.rotate(userId, old.token.id)).toEqual({ ok: false, error: 'not_found' });
  });

  it('lists a user\'s tokens without secrets or digests', () => {
    const { userId, namespaceId } = pilotUser();
    const { secret } = mint(userId, namespaceId);
    const listed = accessTokenService.list(userId);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(secret.slice(13));
    expect(listed[0]).not.toHaveProperty('token_digest');
  });
});
