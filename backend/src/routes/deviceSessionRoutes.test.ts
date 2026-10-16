import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { getConfig, resetConfigForTests } from '../config/env.js';
import { accountService } from '../services/accountService.js';
import { signJwt } from '../services/authService.js';
import { approvePairing, pollPairing, revokeDeviceGrant, startPairing } from '../services/devicePairingService.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from '../tests/integration/testSessionFixtures.js';
import { getDb } from '../persistence/database.js';
import { stillHasAccess } from '../middleware/auth.js';
import { realmAccess } from '../realms/access.js';

// TV sign-ins are gameplay only (TV sign-in plan, decision 3). Every route of the real
// app is classified here: a new route fails this test until it is listed as allowed
// or blocked for TVs, so account-level routes cannot slip through.

const DEVICE_BLOCKED_ROUTES = [
  'DELETE /namespace/invitations/:id',
  'DELETE /session/:id',
  'GET /access-tokens',
  'GET /access-tokens/auto-confirm',
  'GET /access-tokens/grants',
  'GET /auth/devices',
  'GET /auth/session/namespaces',
  'GET /namespace/invitations',
  'GET /oauth-consent/:requestId',
  'PATCH /namespace/invitation-settings',
  'POST /access-tokens',
  'POST /access-tokens/:tokenId/revoke',
  'POST /access-tokens/:tokenId/rotate',
  'POST /access-tokens/auto-confirm/:sessionId',
  'POST /access-tokens/grants/:grantId/revoke',
  'POST /access-tokens/request',
  'POST /auth/device/approve',
  'POST /auth/device/deny',
  'POST /auth/device/lookup',
  'POST /auth/devices/:id/revoke',
  'POST /auth/invitations/accept',
  'POST /auth/invitations/inspect',
  'POST /auth/session/namespace',
  'POST /namespace/invitations',
  'POST /namespace/invitations/:id/resend',
  'POST /namespace/limit-request',
  'POST /oauth-consent/:requestId',
  'POST /settings',
];

// Gameplay, read-only realm info, the TV's own sign-in flow, and routes that never
// take a website cookie (bearer MCP, OAuth, webhooks, health).
const DEVICE_ALLOWED_ROUTES = [
  'ALL /mcp',
  'DELETE /session/:sessionId/character/:charId',
  'GET /.well-known/*path',
  'GET /.well-known/oauth-authorization-server',
  'GET /.well-known/oauth-protected-resource',
  'GET /.well-known/oauth-protected-resource/mcp',
  'GET /auth/config',
  'GET /auth/device/poll',
  'GET /auth/google',
  'GET /auth/google/callback',
  'GET /auth/invite-info',
  'GET /auth/me',
  'GET /auth/namespaces',
  'GET /capabilities',
  'GET /character/:charId/history-summary',
  'GET /characters/all',
  'GET /health',
  'GET /mcp/.well-known/*path',
  'GET /namespace/limits',
  'GET /namespace/usage',
  'GET /oauth/authorize',
  'GET /session/:id',
  'GET /session/:id/events',
  'GET /session/:id/history',
  'GET /session/:id/operations/:operationId',
  'GET /session/:id/origin-story',
  'GET /session/:id/snapshot',
  'GET /session/:id/summary',
  'GET /sessions',
  'GET /sessions/events',
  'GET /settings',
  'PATCH /session/:id',
  'POST /auth/*path',
  'POST /auth/device/start',
  'POST /auth/email/resend',
  'POST /auth/email/start',
  'POST /auth/email/verify',
  'POST /auth/logout',
  'POST /auth/request-invite',
  'POST /auth/select-namespace',
  'POST /character/create',
  'POST /character/suggest-stats',
  'POST /mcp',
  'POST /oauth/register',
  'POST /oauth/revoke',
  'POST /oauth/token',
  'POST /session/:id/action',
  'POST /session/:id/adventure/continue',
  'POST /session/:id/adventure/end',
  'POST /session/:id/adventure/wrap-up',
  'POST /session/:id/ask',
  'POST /session/:id/ideas',
  'POST /session/:id/origin-story',
  'POST /session/:id/preview-action',
  'POST /session/:id/preview-image',
  'POST /session/:id/regenerate-dm-prep',
  'POST /session/:id/savings-mode',
  'POST /session/:id/start',
  'POST /session/:id/suggest-stat',
  'POST /session/create',
  'POST /session/instant-start',
  'POST /session/quick-start',
  'POST /tts',
  'POST /webhooks/kofi',
  'PUT /character/:charId',
];

// Public routes that only peek at the cookie: a revoked TV is simply signed out there.
const PEEK_ROUTES = ['POST /auth/invitations/accept', 'POST /auth/invitations/inspect'];

type Layer = { route?: { path: string | string[]; methods: Record<string, boolean> }; handle?: { stack?: Layer[] } };

// Walks Express 5's router stack, including nested routers (all mounted at the root).
const collectRoutes = (stack: Layer[]): string[] => stack.flatMap(layer => {
  if (layer.route) {
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    return Object.keys(layer.route.methods).flatMap(method => paths.map(p => `${method === '_all' ? 'ALL' : method.toUpperCase()} ${p}`));
  }
  return layer.handle?.stack ? collectRoutes(layer.handle.stack) : [];
});

const ORIGIN = 'http://localhost:5173';
const SESSION_ID = 'device-routes-session';
let paths: IntegrationTestPaths;
let server: Server;
let baseUrl: string;
let routes: string[];
let tvCookie: string;
let revokedTvCookie: string;
let ipCounter = 0;

const pairTv = (user: { userId: string; namespaceId: string; email: string }) => {
  const tv = startPairing(undefined, 'Tizen TV', `10.2.0.${++ipCounter}`);
  if (tv.status !== 'started') {
    throw new Error('start failed');
  }
  approvePairing({ code: tv.userCode, userId: user.userId, namespaceId: user.namespaceId }, `10.2.0.${++ipCounter}`);
  const poll = pollPairing(tv.deviceToken);
  if (poll.status !== 'approved') {
    throw new Error('not approved');
  }
  const { identity } = poll;
  const token = signJwt({ email: identity.email, namespaceId: identity.namespaceId, type: 'full', userId: identity.userId, deviceGrantId: identity.grantId });
  return { cookie: `jwt=${token}`, grantId: identity.grantId };
};

const request = (route: string, cookie: string) => {
  const [method, routePath] = route.split(' ');
  const url = routePath.replace(':id', SESSION_ID).replace(/:[A-Za-z]+/g, 'x');
  return fetch(`${baseUrl}${url}`, {
    method,
    headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : '{}',
  });
};

beforeAll(async () => {
  paths = setupIntegrationEnvironment('device-routes');
  process.env.AUTH_MODE = 'enabled';
  process.env.JWT_SECRET = 'device-routes-test-secret-long-enough-for-tests';
  process.env.FRONTEND_URL = ORIGIN;
  resetConfigForTests();
  const app = createApp({ config: getConfig(), hasCloudAI: true, isProduction: false });
  routes = [...new Set(collectRoutes((app as unknown as { router: { stack: Layer[] } }).router.stack))].sort();

  const created = accountService.createUser('tv-routes@example.com', 'TV Routes', 'member', 'free');
  const user = { ...created, email: 'tv-routes@example.com' };
  await insertSessionState(makeTestSession({ id: SESSION_ID }));
  getDb().prepare('UPDATE sessions SET namespace_id = ? WHERE id = ?').run(user.namespaceId, SESSION_ID);
  tvCookie = pairTv(user).cookie;
  const revoked = pairTv(user);
  revokeDeviceGrant(revoked.grantId, user.userId, 'user');
  revokedTvCookie = revoked.cookie;

  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  cleanupIntegrationEnvironment(paths);
  resetConfigForTests();
});

describe('TV sign-in route policy', () => {
  it('classifies every route of the app', () => {
    expect(routes).toEqual([...DEVICE_BLOCKED_ROUTES, ...DEVICE_ALLOWED_ROUTES].sort());
  });

  it.each(DEVICE_BLOCKED_ROUTES)('refuses %s to a TV with 403', async route => {
    const res = await request(route, tvCookie);
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('json');
  });

  it.each(DEVICE_BLOCKED_ROUTES.filter(route => !PEEK_ROUTES.includes(route)))('refuses %s to a signed-out TV with 401', async route => {
    expect((await request(route, revokedTvCookie)).status).toBe(401);
  });

  it('lets a TV play', async () => {
    expect((await request('GET /sessions', tvCookie)).status).toBe(200);
    const me = await request('GET /auth/me', tvCookie);
    expect(await me.json()).toMatchObject({ enabled: true, deviceSession: true });
  });

  it('streams live updates only to members of the adventure realm', async () => {
    const outsider = accountService.createUser('events-outsider@example.com', 'Outsider', 'member', 'free');
    const outsiderCookie = `jwt=${signJwt({ email: 'events-outsider@example.com', namespaceId: outsider.namespaceId, type: 'full', userId: outsider.userId })}`;
    expect((await request('GET /session/:id/events', outsiderCookie)).status).toBe(404);

    const res = await request('GET /session/:id/events', tvCookie);
    expect(res.status).toBe(200);
    await res.body?.cancel();
  });

  it('rechecks stream access for removed members and revoked TVs', () => {
    const owner = accountService.createUser('stream-owner@example.com', 'Stream Owner', 'member', 'free');
    const member = accountService.createUserInExistingNamespace('stream-member@example.com', owner.namespaceId);
    const asRequest = (cookie: string) => ({ cookies: { jwt: cookie.slice('jwt='.length) }, namespaceId: owner.namespaceId }) as unknown as Request;
    const memberReq = asRequest(`jwt=${signJwt({ email: 'stream-member@example.com', namespaceId: owner.namespaceId, type: 'full', userId: member.userId })}`);
    expect(stillHasAccess(memberReq)).toBe(true);
    realmAccess.removeMember(member.userId, owner.namespaceId);
    expect(stillHasAccess(memberReq)).toBe(false);

    const tv = pairTv({ ...owner, email: 'stream-owner@example.com' });
    const tvReq = asRequest(tv.cookie);
    expect(stillHasAccess(tvReq)).toBe(true);
    revokeDeviceGrant(tv.grantId, owner.userId, 'user');
    expect(stillHasAccess(tvReq)).toBe(false);
  });

  it('hands the turn to the next hero when the active hero is deleted', async () => {
    const base = makeTestSession();
    const party = base.party.map(c => ({ ...c, id: `dh-${c.id}`, inventory: c.inventory.map(item => ({ ...item, id: `dh-${item.id}` })) }));
    await insertSessionState(makeTestSession({ id: 'delete-handoff', party, activeCharacterId: party[0].id }));
    const namespaceId = getDb().prepare('SELECT namespace_id FROM sessions WHERE id = ?').get(SESSION_ID) as { namespace_id: string };
    getDb().prepare('UPDATE sessions SET namespace_id = ? WHERE id = ?').run(namespaceId.namespace_id, 'delete-handoff');

    const res = await fetch(`${baseUrl}/session/delete-handoff/character/${party[0].id}`, { method: 'DELETE', headers: { cookie: tvCookie, origin: ORIGIN } });
    expect(res.status).toBe(200);
    const row = getDb().prepare('SELECT activeCharacterId FROM sessions WHERE id = ?').get('delete-handoff') as { activeCharacterId: string };
    expect(row.activeCharacterId).toBe(party[1].id);
  });

  it('marks pairing and device responses as not cacheable', async () => {
    const res = await fetch(`${baseUrl}/auth/device/poll`);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('kill switch hides pairing and signs TVs out', async () => {
    process.env.DEVICE_SIGN_IN_DISABLED = 'true';
    resetConfigForTests();
    try {
      expect((await request('POST /auth/device/start', '')).status).toBe(404);
      expect((await request('GET /sessions', tvCookie)).status).toBe(401);
    } finally {
      delete process.env.DEVICE_SIGN_IN_DISABLED;
      resetConfigForTests();
    }
    expect((await request('GET /sessions', tvCookie)).status).toBe(200);
  });

  it('signs a TV out when it logs out', async () => {
    const user = accountService.createUser('tv-logout@example.com', 'TV Logout', 'member', 'free');
    const tv = pairTv({ ...user, email: 'tv-logout@example.com' });
    await request('POST /auth/logout', tv.cookie);
    expect((await request('GET /sessions', tv.cookie)).status).toBe(401);
  });
});
