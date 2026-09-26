import crypto from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '../config/env.js';
import { getDb } from '../persistence/database.js';
import { StateService } from '../services/stateService.js';
import { userRepository } from '../repositories/userRepository.js';
import { createPilot, makeCallTool, setMcpTestEnv, startMcpServer } from '../mcp/testHarness.js';
import { resetMcpRateLimits } from '../mcp/auth.js';
import { oauthAuthorizationService } from './authorizationService.js';
import type { AccessTokenScope } from '../types.js';

// End to end over HTTP: register, authorize, consent (service call, the website side is
// cookie-authenticated), token, then /mcp with the access token. Plus the kill switch.

const DB_PATH = path.join(os.tmpdir(), `dnd-oauth-flow-test-${Date.now()}.sqlite`);
const RESOURCE = 'https://api.example.com/mcp';
const REDIRECT = 'http://127.0.0.1/callback';

let server: Server;
let baseUrl: string;
let callTool: ReturnType<typeof makeCallTool>;
let clientId: string;
let seq = 0;

const setOAuth = (enabled: boolean) => {
  process.env.MCP_OAUTH_ENABLED = enabled ? 'true' : 'false';
  resetConfigForTests();
};

const form = (path: string, fields: Record<string, string | undefined>) => fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== undefined)).toString(),
});

const signIn = async (scopes: AccessTokenScope[] = ['adventures:play']) => {
  const user = userRepository.createUser(`oauth-flow-${++seq}@example.com`);
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const authorize = await fetch(`${baseUrl}/oauth/authorize?${new URLSearchParams({
    client_id: clientId, redirect_uri: 'http://127.0.0.1:50123/callback', response_type: 'code', code_challenge: challenge,
    code_challenge_method: 'S256', scope: 'adventures:read adventures:play', state: 'st', resource: RESOURCE,
  }).toString()}`, { redirect: 'manual' });
  expect(authorize.status).toBe(302);
  const consentUrl = new URL(authorize.headers.get('location')!);
  expect(consentUrl.origin + consentUrl.pathname).toBe('https://play.example.com/oauth/consent');
  const decision = oauthAuthorizationService.decide(consentUrl.searchParams.get('request')!, user, { approve: true, namespaceId: user.namespaceId, scopes });
  if (!decision.ok) {
    throw new Error(decision.error);
  }
  const callback = new URL(decision.redirectUrl);
  expect(callback.searchParams.get('iss')).toBe('https://api.example.com');
  const tokenRes = await form('/oauth/token', {
    grant_type: 'authorization_code', client_id: clientId, code: callback.searchParams.get('code')!,
    redirect_uri: 'http://127.0.0.1:50123/callback', code_verifier: verifier, resource: RESOURCE,
  });
  expect(tokenRes.status).toBe(200);
  expect(tokenRes.headers.get('cache-control')).toBe('no-store');
  return { user, tokens: await tokenRes.json() as { access_token: string; refresh_token: string } };
};

beforeAll(async () => {
  setMcpTestEnv(DB_PATH);
  process.env.MCP_PUBLIC_URL = RESOURCE;
  process.env.FRONTEND_URL = 'https://play.example.com';
  setOAuth(true);
  StateService.initialize();
  ({ server, baseUrl } = startMcpServer());
  callTool = makeCallTool(baseUrl);
  const registration = await fetch(`${baseUrl}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Flow Test', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] }),
  });
  expect(registration.status).toBe(201);
  clientId = (await registration.json() as { client_id: string }).client_id;
});

afterAll(() => {
  server.close();
  delete process.env.MCP_OAUTH_ENABLED;
  resetConfigForTests();
  fs.rmSync(DB_PATH, { force: true });
});

describe('OAuth flow over HTTP', () => {
  it('signs in and plays through /mcp with the access token', async () => {
    resetMcpRateLimits();
    const { tokens } = await signIn();
    const list = await callTool(tokens.access_token, 'list_adventures', {});
    expect(list.status).toBe(200);
    expect(list.body?.result?.isError).toBeFalsy();
  });

  it('refreshes over HTTP and the new access token works', async () => {
    const { tokens } = await signIn();
    const res = await form('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token, resource: RESOURCE });
    expect(res.status).toBe(200);
    const next = await res.json() as { access_token: string };
    expect((await callTool(next.access_token, 'list_adventures', {})).status).toBe(200);
    const reuse = await form('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token });
    expect(reuse.status).toBe(400);
    expect(await reuse.json()).toMatchObject({ error: 'invalid_grant' });
    // The reuse revoked the whole grant, including the fresh access token.
    expect((await callTool(next.access_token, 'list_adventures', {})).status).toBe(401);
  });

  it('refuses an unknown client and an unsupported grant type', async () => {
    expect((await form('/oauth/token', { grant_type: 'authorization_code', client_id: 'dcr_nope', code: 'x' })).status).toBe(401);
    const res = await form('/oauth/token', { grant_type: 'password', client_id: clientId });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unsupported_grant_type' });
  });

  it('rejects a token whose grant is for another resource (audience)', async () => {
    const { tokens } = await signIn();
    getDb().prepare("UPDATE oauth_grants SET resource = 'https://other.example.com/mcp' WHERE id IN (SELECT grant_id FROM oauth_tokens)").run();
    expect((await callTool(tokens.access_token, 'list_adventures', {})).status).toBe(401);
    getDb().prepare('UPDATE oauth_grants SET resource = ?').run(RESOURCE);
  });

  it('tells an OAuth assistant to reconnect for a missing permission', async () => {
    const { tokens } = await signIn(['adventures:play']);
    const res = await callTool(tokens.access_token, 'create_adventure', { premise: 'A silly forest', requestId: 'req-12345678' });
    expect(res.body?.result?.isError).toBe(true);
    expect(res.body?.result?.content?.[0]?.text).toMatch(/Reconnect the assistant and tick "Start new adventures"/);
  });

  it('kill switch: OAuth stops, revocation and personal tokens keep working, and it comes back', async () => {
    const kept = await signIn();
    const revoked = await signIn();
    const pilot = createPilot(`oauth-flow-pat-${++seq}@example.com`);
    setOAuth(false);
    try {
      const denied = await callTool(kept.tokens.access_token, 'list_adventures', {});
      expect(denied.status).toBe(401);
      expect(denied.headers.get('www-authenticate')).not.toContain('resource_metadata');
      expect((await form('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: kept.tokens.refresh_token })).status).toBe(404);
      expect((await fetch(`${baseUrl}/oauth/authorize?client_id=${clientId}`, { redirect: 'manual' })).status).toBe(404);
      expect((await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)).status).toBe(404);
      expect((await fetch(`${baseUrl}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404);
      expect((await form('/oauth/revoke', { token: revoked.tokens.refresh_token, client_id: clientId })).status).toBe(200);
      expect((await callTool(pilot.secret, 'list_adventures', {})).status).toBe(200);
    } finally {
      setOAuth(true);
    }
    expect((await callTool(kept.tokens.access_token, 'list_adventures', {})).status).toBe(200);
    expect((await callTool(revoked.tokens.access_token, 'list_adventures', {})).status).toBe(401);
  });
});
