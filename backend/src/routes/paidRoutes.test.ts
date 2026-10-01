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
import { turnHistoryRepository } from '../repositories/turnHistoryRepository.js';
import { acceptSessionOperation } from '../services/sessionOperationService.js';
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

// The action route admits after parsing, replay and validation (plan 5 B1), so it
// needs a valid body to reach admission.
const ACTION_BODY = { action: 'Pip sneaks past the cook', statUsed: 'mischief' };
const post = (route: string, realm?: string, body: unknown = route.endsWith('/action') ? ACTION_BODY : {}) => fetch(`${baseUrl}${route}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(realm && { 'x-test-realm': realm }) },
  body: JSON.stringify(body),
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

  // Behaviour change (plan 4 B4). Before: the GET summary routes were limited only by the
  // provider backstop. After: explicit admission, with the free answer first.
  it('refuses the adventure summary once the budget is spent', async () => {
    const res = await fetch(`${baseUrl}/session/${SESSION_ID}/summary`);
    expect(res.status).toBe(429);
  });

  it('answers a hero with no turns without admission, and refuses one with turns', async () => {
    const empty = await fetch(`${baseUrl}/character/char-zara/history-summary`);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ summary: null });

    turnHistoryRepository.insertTurnResultSync(SESSION_ID, { narration: 'Pip stole a pie.', choices: [], imagePrompt: null, imageSuggested: false }, 'char-pip');
    expect((await fetch(`${baseUrl}/character/char-pip/history-summary`)).status).toBe(429);
  });

  // Behaviour change (plan 5 B1). Before: a retried action whose original was accepted
  // got 429 once the budget ran out. After: it gets its original operation.
  it('replays an accepted action on a spent budget', async () => {
    const accepted = acceptSessionOperation({ sessionId: SESSION_ID, namespaceId: spentRealm, kind: 'action', requestId: 'paid-replay-1', payload: ACTION_BODY });
    expect(accepted.type).toBe('accepted');

    const res = await post(`/session/${SESSION_ID}/action`, undefined, { ...ACTION_BODY, requestId: 'paid-replay-1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ replayed: true, operation: { id: accepted.type === 'accepted' ? accepted.operation.id : '' } });
  });

  it('still answers reads on a spent budget', async () => {
    expect((await fetch(`${baseUrl}/sessions`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/session/${SESSION_ID}`)).status).toBe(200);
  });
});
