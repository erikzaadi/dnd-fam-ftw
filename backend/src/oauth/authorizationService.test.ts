import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '../config/env.js';
import { initializeDatabase } from '../persistence/database.js';
import { userRepository } from '../repositories/userRepository.js';
import { oauthClientService } from './clientService.js';
import { oauthAuthorizationService, type AuthorizeOutcome } from './authorizationService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-oauth-authorize-test-${Date.now()}.sqlite`);
const REDIRECT = 'http://127.0.0.1/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const ISS = 'https://api.example.com';

let clientId: string;

const validQuery = (overrides: Record<string, unknown> = {}) => ({
  client_id: clientId,
  redirect_uri: 'http://127.0.0.1:41234/callback',
  response_type: 'code',
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  scope: 'adventures:read adventures:play',
  state: 'xyz',
  resource: 'https://api.example.com/mcp',
  ...overrides,
});

const redirectParams = (outcome: AuthorizeOutcome): URLSearchParams => {
  if (outcome.kind !== 'redirect') {
    throw new Error(`expected a redirect, got page: ${outcome.message}`);
  }
  return new URL(outcome.url).searchParams;
};

const startRequest = async (): Promise<string> => {
  const outcome = await oauthAuthorizationService.startAuthorization(validQuery());
  if (outcome.kind !== 'redirect' || !outcome.url.startsWith('https://play.example.com/oauth/consent?')) {
    throw new Error('expected the consent page');
  }
  return new URL(outcome.url).searchParams.get('request')!;
};

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.AUTH_MODE = 'enabled';
  process.env.JWT_SECRET = 'oauth-authorize-test-secret-long-enough';
  process.env.MCP_ENABLED = 'true';
  process.env.MCP_OAUTH_ENABLED = 'true';
  process.env.MCP_PUBLIC_URL = 'https://api.example.com/mcp';
  process.env.FRONTEND_URL = 'https://play.example.com';
  resetConfigForTests();
  initializeDatabase();
  const registered = oauthClientService.registerDynamicClient({ client_name: 'Test Assistant', redirect_uris: [REDIRECT] }, '203.0.113.9');
  if (!registered.ok) {
    throw new Error(registered.error);
  }
  clientId = registered.client.clientId;
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

describe('startAuthorization', () => {
  it('parks a valid request and sends the browser to the consent page', async () => {
    expect(await startRequest()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('shows a page, never a redirect, for unknown clients and unregistered redirect URIs', async () => {
    expect(await oauthAuthorizationService.startAuthorization(validQuery({ client_id: 'dcr_unknown' }))).toMatchObject({ kind: 'page', status: 400 });
    expect(await oauthAuthorizationService.startAuthorization(validQuery({ redirect_uri: 'https://evil.example.com/cb' }))).toMatchObject({ kind: 'page', status: 400 });
    expect(await oauthAuthorizationService.startAuthorization(validQuery({ client_id: [clientId, clientId] }))).toMatchObject({ kind: 'page', status: 400 });
  });

  it('reports other errors to the client with state and iss', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ code_challenge: undefined }, 'invalid_request'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ code_challenge_method: undefined }, 'invalid_request'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ scope: 'adventures:read admin' }, 'invalid_scope'],
      [{ resource: 'https://other.example.com/mcp' }, 'invalid_target'],
    ];
    for (const [overrides, error] of cases) {
      const params = redirectParams(await oauthAuthorizationService.startAuthorization(validQuery(overrides)));
      expect(params.get('error')).toBe(error);
      expect(params.get('state')).toBe('xyz');
      expect(params.get('iss')).toBe(ISS);
      expect(params.get('code')).toBeNull();
    }
  });

  it('accepts an absent resource (bound to this server) and an absent scope (defaults)', async () => {
    const outcome = await oauthAuthorizationService.startAuthorization(validQuery({ resource: undefined, scope: undefined }));
    expect(outcome.kind === 'redirect' && outcome.url.startsWith('https://play.example.com/oauth/consent?')).toBe(true);
  });
});

describe('consent', () => {
  it('lists the player\'s realms with their eligibility', async () => {
    const founder = userRepository.createUser('consent-founder@example.com', 'Founders', 'member', 'unlimited');
    const requestId = await startRequest();
    const details = oauthAuthorizationService.getConsentDetails(requestId, { userId: founder.userId, email: 'consent-founder@example.com', currentNamespaceId: founder.namespaceId });
    expect(details).toMatchObject({
      client: { name: 'Test Assistant', verifiedHost: null, redirectHost: '127.0.0.1:41234' },
      requestedScopes: ['adventures:read', 'adventures:play'],
      realms: [{ id: founder.namespaceId, name: 'Founders', eligible: true }],
    });
    expect(oauthAuthorizationService.getConsentDetails('unknown', { userId: founder.userId, email: 'consent-founder@example.com', currentNamespaceId: founder.namespaceId })).toBeNull();
  });

  it('denial redirects with access_denied, state, and iss, once', async () => {
    const user = userRepository.createUser('consent-deny@example.com');
    const requestId = await startRequest();
    const result = oauthAuthorizationService.decide(requestId, user, { approve: false });
    if (!result.ok) {
      throw new Error(result.error);
    }
    const params = new URL(result.redirectUrl).searchParams;
    expect(params.get('error')).toBe('access_denied');
    expect(params.get('state')).toBe('xyz');
    expect(params.get('iss')).toBe(ISS);
    expect(oauthAuthorizationService.decide(requestId, user, { approve: false })).toMatchObject({ ok: false, status: 404 });
  });

  it('refuses a realm without assistant access or membership, without using up the request', async () => {
    const player = userRepository.createUser('consent-free@example.com', undefined, 'member', 'free');
    const stranger = userRepository.createUser('consent-stranger@example.com');
    const requestId = await startRequest();
    const approve = (namespaceId: string) => oauthAuthorizationService.decide(requestId, player, { approve: true, namespaceId, scopes: ['adventures:play'] });
    expect(approve(player.namespaceId)).toMatchObject({ ok: false, status: 403, error: 'not_eligible' });
    expect(approve(stranger.namespaceId)).toMatchObject({ ok: false, status: 403, error: 'not_eligible' });
    userRepository.setMcpAccess(player.userId, 'on');
    const result = approve(player.namespaceId);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const params = new URL(result.redirectUrl).searchParams;
    expect(result.redirectUrl.startsWith('http://127.0.0.1:41234/callback?')).toBe(true);
    expect(params.get('code')).toMatch(/^dndoac_/);
    expect(params.get('state')).toBe('xyz');
    expect(params.get('iss')).toBe(ISS);
  });

  it('answers a request exactly once under concurrent approvals', async () => {
    const user = userRepository.createUser('consent-race@example.com');
    const requestId = await startRequest();
    const results = await Promise.all(Array.from({ length: 20 }, () => Promise.resolve().then(() =>
      oauthAuthorizationService.decide(requestId, user, { approve: true, namespaceId: user.namespaceId, scopes: ['adventures:play'] }))));
    expect(results.filter(result => result.ok)).toHaveLength(1);
  });
});
