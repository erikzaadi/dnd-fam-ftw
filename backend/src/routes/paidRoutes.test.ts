import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '../config/env.js';
import { runWithUsageContext } from '../lib/usageContext.js';
import { getDb } from '../persistence/database.js';
import { usageRepository } from '../repositories/usageRepository.js';
import { accountService } from '../services/accountService.js';
import { createUsageContext } from '../services/usageAttribution.js';
import { getTierLimits } from '../services/usageLimitService.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from '../tests/integration/testSessionFixtures.js';
import { createGameRouter } from './gameRoutes.js';

// Which HTTP routes start paid work (architecture-deepening plan 4). Once a realm's
// daily text budget is spent, every paid route answers 429 before any work starts, and
// a realm without a valid owner gets 503 on the same routes. Other routes still answer.
// A paid route that is missed here would quietly start AI work on a spent budget.

const SESSION_ID = 'paid-routes-session';

const PAID_ROUTES = [
  '/session/quick-start',
  '/session/instant-start',
  '/session/create',
  ...['action', 'ask', 'ideas', 'start', 'origin-story', 'suggest-stat', 'preview-action', 'preview-image', 'regenerate-dm-prep']
    .map(route => `/session/${SESSION_ID}/${route}`),
  `/session/${SESSION_ID}/adventure/wrap-up`,
  `/session/${SESSION_ID}/adventure/continue`,
  '/character/create',
  '/character/suggest-stats',
];

let paths: IntegrationTestPaths;
let server: Server;
let baseUrl: string;
let spentRealm: string;
let spentUser: string;
let ownerlessRealm: string;

beforeAll(async () => {
  paths = setupIntegrationEnvironment('paid-routes');
  resetConfigForTests();
  const spent = accountService.createUser('paid-routes@example.com', 'Spent', 'member', 'free');
  spentRealm = spent.namespaceId;
  spentUser = spent.userId;
  const limit = getTierLimits('free').textCreditsPerDay!;
  for (let i = 0; i < limit; i++) {
    usageRepository.recordProviderUsage({
      namespaceId: spentRealm, userId: spentUser, ownerUserId: spentUser, attribution: 'verified', sessionId: null, kind: 'text', endpoint: '/test', model: null,
      inputTokens: null, outputTokens: null, ttsCharacters: null, imageCount: null, success: true, estimatedCostUsd: 0.001,
    });
  }
  ownerlessRealm = 'paid-routes-ownerless';
  getDb().prepare("INSERT INTO namespaces (id, name, tier) VALUES (?, 'Ownerless', 'free')").run(ownerlessRealm);
  await insertSessionState(makeTestSession({ id: SESSION_ID }));
  getDb().prepare('UPDATE sessions SET namespace_id = ? WHERE id = ?').run(spentRealm, SESSION_ID);

  // Stands in for authMiddleware: the realm comes from a header, the usage context is
  // built the same way.
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.namespaceId = req.header('x-test-realm') ?? spentRealm;
    runWithUsageContext(createUsageContext(req.namespaceId, spentUser), next);
  });
  app.use(createGameRouter());
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

const post = (route: string, realm?: string) => fetch(`${baseUrl}${route}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(realm && { 'x-test-realm': realm }) },
  body: '{}',
});

describe('paid HTTP routes', () => {
  it.each(PAID_ROUTES)('refuses %s once the daily text budget is spent', async route => {
    const res = await post(route);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'limit_reached', kind: 'text', tier: 'free' });
  });

  it.each(PAID_ROUTES.filter(route => !route.includes(SESSION_ID)))('refuses %s for a realm without a valid owner', async route => {
    const res = await post(route, ownerlessRealm);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'realm_owner_missing' });
  });

  it('still answers reads on a spent budget', async () => {
    expect((await fetch(`${baseUrl}/sessions`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/session/${SESSION_ID}`)).status).toBe(200);
  });
});
