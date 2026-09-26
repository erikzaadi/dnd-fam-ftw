import crypto from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '../config/env.js';
import { initializeDatabase } from '../persistence/database.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { oauthGrantRepository } from '../repositories/oauthGrantRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import type { AccessTokenScope } from '../types.js';
import { oauthAuthorizationService } from './authorizationService.js';
import { oauthClientService } from './clientService.js';
import { digestSecret } from './secrets.js';
import { OAuthTokenError, oauthTokenService, type OAuthTokenResponse } from './tokenService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-oauth-token-test-${Date.now()}.sqlite`);
const REDIRECT = 'http://127.0.0.1/callback';
const RESOURCE = 'https://api.example.com/mcp';

let clientId: string;
let otherClientId: string;
let seq = 0;

const registerClient = (name: string): string => {
  const result = oauthClientService.registerDynamicClient({ client_name: name, redirect_uris: [REDIRECT] }, `203.0.113.${++seq}`);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.client.clientId;
};

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

// Runs authorize + consent for a fresh user and returns everything needed to exchange.
const authorize = async (options: { scopes?: AccessTokenScope[]; tier?: string } = {}) => {
  const user = userRepository.createUser(`token-user-${++seq}@example.com`, undefined, 'member', options.tier ?? 'unlimited');
  const { verifier, challenge } = pkce();
  const outcome = await oauthAuthorizationService.startAuthorization({
    client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge,
    code_challenge_method: 'S256', scope: 'adventures:read adventures:play adventures:create', state: 's', resource: RESOURCE,
  });
  if (outcome.kind !== 'redirect') {
    throw new Error(outcome.message);
  }
  const requestId = new URL(outcome.url).searchParams.get('request')!;
  const decision = oauthAuthorizationService.decide(requestId, user, { approve: true, namespaceId: user.namespaceId, scopes: options.scopes ?? ['adventures:play', 'adventures:create'] });
  if (!decision.ok) {
    throw new Error(decision.error);
  }
  const code = new URL(decision.redirectUrl).searchParams.get('code')!;
  return { user, code, verifier };
};

const exchange = (code: string, verifier: string, overrides: Partial<Parameters<typeof oauthTokenService.exchangeCode>[0]> = {}, now?: number) =>
  oauthTokenService.exchangeCode({ clientId, code, redirectUri: REDIRECT, codeVerifier: verifier, resource: RESOURCE, ...overrides }, now);

const connect = async (options: { scopes?: AccessTokenScope[]; tier?: string } = {}) => {
  const { user, code, verifier } = await authorize(options);
  return { user, tokens: exchange(code, verifier) };
};

const grantOf = (tokens: OAuthTokenResponse) => oauthGrantRepository.getGrant(oauthGrantRepository.getToken(digestSecret(tokens.access_token))!.grant_id)!;

const expectOAuthError = (fn: () => unknown, error: string) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(OAuthTokenError);
    expect((err as OAuthTokenError).error).toBe(error);
    return;
  }
  throw new Error(`expected ${error}`);
};

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.AUTH_MODE = 'enabled';
  process.env.JWT_SECRET = 'oauth-token-test-secret-long-enough';
  process.env.MCP_ENABLED = 'true';
  process.env.MCP_OAUTH_ENABLED = 'true';
  process.env.MCP_PUBLIC_URL = RESOURCE;
  process.env.FRONTEND_URL = 'https://play.example.com';
  resetConfigForTests();
  initializeDatabase();
  clientId = registerClient('Assistant');
  otherClientId = registerClient('Other');
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

describe('authorization code exchange', () => {
  it('issues an access and refresh token pair bound to a new grant', async () => {
    const { user, tokens } = await connect();
    expect(tokens.access_token).toMatch(/^dndoat_/);
    expect(tokens.refresh_token).toMatch(/^dndort_/);
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 900, scope: 'adventures:read adventures:play adventures:create' });
    expect(grantOf(tokens)).toMatchObject({ user_id: user.userId, namespace_id: user.namespaceId, client_id: clientId, resource: RESOURCE, revoked_at: null });
  });

  it('refuses a wrong verifier, client, redirect URI, or resource, and an expired code', async () => {
    const { code, verifier } = await authorize();
    expectOAuthError(() => exchange(code, pkce().verifier), 'invalid_grant');
    expectOAuthError(() => exchange(code, verifier, { clientId: otherClientId }), 'invalid_grant');
    expectOAuthError(() => exchange(code, verifier, { redirectUri: 'http://127.0.0.1/other' }), 'invalid_grant');
    expectOAuthError(() => exchange(code, verifier, { resource: 'https://other.example.com/mcp' }), 'invalid_target');
    expectOAuthError(() => exchange(code, verifier, {}, Date.now() + 61_000), 'invalid_grant');
    // None of those used the code up; an absent resource is bound to this server.
    expect(exchange(code, verifier, { resource: undefined }).access_token).toMatch(/^dndoat_/);
  });

  it('revokes the grant when a code is replayed, and the revocation sticks', async () => {
    const { code, verifier } = await authorize();
    const tokens = exchange(code, verifier);
    expectOAuthError(() => exchange(code, verifier), 'invalid_grant');
    expect(grantOf(tokens).revoked_at).not.toBeNull();
  });

  it('lets exactly one of 20 concurrent exchanges win', async () => {
    const { code, verifier } = await authorize();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => Promise.resolve().then(() => exchange(code, verifier))));
    const won = results.filter(result => result.status === 'fulfilled');
    expect(won).toHaveLength(1);
    // The replays mark the code as stolen: the grant it created is revoked.
    expect(grantOf((won[0] as PromiseFulfilledResult<OAuthTokenResponse>).value).revoked_at).not.toBeNull();
  });

  it('refuses when assistant access ended between consent and exchange', async () => {
    const { user, code, verifier } = await authorize();
    userRepository.setMcpAccess(user.userId, 'off');
    expectOAuthError(() => exchange(code, verifier), 'invalid_grant');
  });
});

describe('refresh', () => {
  const refresh = (refreshToken: string, overrides: Partial<Parameters<typeof oauthTokenService.refresh>[0]> = {}) =>
    oauthTokenService.refresh({ clientId, refreshToken, scope: undefined, resource: RESOURCE, ...overrides });

  it('rotates: the new pair works and the old refresh token is spent', async () => {
    const { tokens } = await connect();
    const next = refresh(tokens.refresh_token);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(grantOf(next).id).toBe(grantOf(tokens).id);
    expect(refresh(next.refresh_token).access_token).toMatch(/^dndoat_/);
  });

  it('revokes the grant when an old refresh token is reused', async () => {
    const { tokens } = await connect();
    const next = refresh(tokens.refresh_token);
    expectOAuthError(() => refresh(tokens.refresh_token), 'invalid_grant');
    expect(grantOf(next).revoked_at).not.toBeNull();
    expectOAuthError(() => refresh(next.refresh_token), 'invalid_grant');
  });

  it('refuses an access token presented as a refresh token', async () => {
    const { tokens } = await connect();
    expectOAuthError(() => refresh(tokens.access_token), 'invalid_grant');
    expect(grantOf(tokens).revoked_at).toBeNull();
  });

  it('revokes the grant when another client presents the refresh token', async () => {
    const { tokens } = await connect();
    expectOAuthError(() => refresh(tokens.refresh_token, { clientId: otherClientId }), 'invalid_grant');
    expect(grantOf(tokens).revoked_at).not.toBeNull();
  });

  it('never widens scope, but honors a narrower request', async () => {
    const { tokens } = await connect({ scopes: ['adventures:play'] });
    expectOAuthError(() => refresh(tokens.refresh_token, { scope: 'adventures:read adventures:play adventures:create' }), 'invalid_scope');
    expect(grantOf(tokens).revoked_at).toBeNull();
    const narrower = refresh(tokens.refresh_token, { scope: 'adventures:read' });
    expect(narrower.scope).toBe('adventures:read');
    expect(grantOf(narrower).scopes).toBe('adventures:read adventures:play');
  });

  it('refuses a wrong resource and accepts an absent one', async () => {
    const { tokens } = await connect();
    expectOAuthError(() => refresh(tokens.refresh_token, { resource: 'https://other.example.com/mcp' }), 'invalid_target');
    expect(refresh(tokens.refresh_token, { resource: undefined }).access_token).toMatch(/^dndoat_/);
  });

  it('ends the grant when access is turned off or the realm drops tier', async () => {
    const off = await connect();
    userRepository.setMcpAccess(off.user.userId, 'off');
    expectOAuthError(() => refresh(off.tokens.refresh_token), 'invalid_grant');
    expect(grantOf(off.tokens).revoked_at).not.toBeNull();

    const dropped = await connect();
    namespaceRepository.setNamespaceTier(dropped.user.namespaceId, 'free');
    expectOAuthError(() => refresh(dropped.tokens.refresh_token), 'invalid_grant');
    expect(grantOf(dropped.tokens).revoked_at).not.toBeNull();
  });

  it('lets exactly one of 20 concurrent refreshes win', async () => {
    const { tokens } = await connect();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => Promise.resolve().then(() => refresh(tokens.refresh_token))));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('refuses a revoked grant', async () => {
    const { tokens } = await connect();
    oauthTokenService.revoke({ token: tokens.access_token, clientId });
    expectOAuthError(() => refresh(tokens.refresh_token), 'invalid_grant');
  });
});

describe('revocation', () => {
  it('ends the grant from either token, ignores other clients and unknown tokens', async () => {
    const { tokens } = await connect();
    oauthTokenService.revoke({ token: tokens.refresh_token, clientId: otherClientId });
    expect(grantOf(tokens).revoked_at).toBeNull();
    oauthTokenService.revoke({ token: 'dndort_unknown', clientId });
    oauthTokenService.revoke({ token: tokens.refresh_token, clientId });
    expect(grantOf(tokens).revoked_at).not.toBeNull();
  });
});
