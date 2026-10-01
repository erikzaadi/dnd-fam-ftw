import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '../config/env.js';
import { runWithUsageContext } from '../lib/usageContext.js';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { usageRepository } from '../repositories/usageRepository.js';
import type { McpPrincipal } from '../services/accessTokenService.js';
import { getTierLimits } from '../services/usageLimitService.js';
import { admitPaidCall } from './admission.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-mcp-admission-test-${Date.now()}.sqlite`);

const principal = (grantId: string, namespaceId: string, credentialId: string = grantId): McpPrincipal => ({
  grantId, credential: { kind: grantId === credentialId ? 'pat' : 'oauth', id: credentialId }, userId: 'u', email: 'e@example.com', namespaceId, scopes: ['adventures:read', 'adventures:play'], expiresAt: Date.now() + 1000,
});

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.MCP_DAILY_PAID_CALLS_PER_TOKEN = '2';
  initializeDatabase();
  getDb().prepare("INSERT INTO namespaces (id, name, tier) VALUES ('ns-free', 'Free', 'free'), ('ns-open', 'Open', 'unlimited'), ('ns-ownerless', 'Ownerless', 'free')").run();
});

afterAll(() => {
  delete process.env.MCP_DAILY_PAID_CALLS_PER_TOKEN;
  fs.rmSync(DB_PATH, { force: true });
});

describe('admitPaidCall', () => {
  it('caps paid calls per token per day', () => {
    const now = Date.UTC(2026, 8, 26, 12);
    expect(admitPaidCall(principal('t1', 'ns-open'), now)).toEqual({ ok: true });
    expect(admitPaidCall(principal('t1', 'ns-open'), now)).toEqual({ ok: true });
    expect(admitPaidCall(principal('t1', 'ns-open'), now)).toMatchObject({ ok: false, code: 'token_daily_limit' });
    // Another token, and the next UTC day, start fresh.
    expect(admitPaidCall(principal('t2', 'ns-open'), now)).toEqual({ ok: true });
    expect(admitPaidCall(principal('t1', 'ns-open'), now + 24 * 60 * 60 * 1000)).toEqual({ ok: true });
  });

  it('counts per grant, so rotated OAuth access tokens share one cap', () => {
    const now = Date.UTC(2026, 8, 27, 12);
    expect(admitPaidCall(principal('g1', 'ns-open', 'access-1'), now)).toEqual({ ok: true });
    expect(admitPaidCall(principal('g1', 'ns-open', 'access-2'), now)).toEqual({ ok: true });
    expect(admitPaidCall(principal('g1', 'ns-open', 'access-3'), now)).toMatchObject({ ok: false, code: 'token_daily_limit' });
  });

  it('uses the realm\'s daily usage budget, like the website', () => {
    const limit = getTierLimits('free').textCreditsPerDay!;
    for (let i = 0; i < limit; i++) {
      usageRepository.recordProviderUsage({
        namespaceId: 'ns-free', userId: null, ownerUserId: null, attribution: 'system', sessionId: null, kind: 'text', endpoint: '/test', model: null,
        inputTokens: null, outputTokens: null, ttsCharacters: null, imageCount: null, success: true, estimatedCostUsd: 0.001,
      });
    }
    expect(admitPaidCall(principal('t3', 'ns-free'))).toMatchObject({ ok: false, code: 'limit_reached' });
  });

  // Characterization (architecture-deepening plan 4): the order of the checks.
  it('refuses on a spent realm budget without using up a grant attempt', () => {
    const now = Date.UTC(2026, 8, 28, 12);
    for (let i = 0; i < 3; i++) {
      expect(admitPaidCall(principal('g-order', 'ns-free'), now)).toMatchObject({ ok: false, code: 'limit_reached' });
    }
    // The same grant still has both of its attempts.
    expect(admitPaidCall(principal('g-order', 'ns-open'), now)).toEqual({ ok: true });
    expect(admitPaidCall(principal('g-order', 'ns-open'), now)).toEqual({ ok: true });
    expect(admitPaidCall(principal('g-order', 'ns-open'), now)).toMatchObject({ ok: false, code: 'token_daily_limit' });
  });

  // Behaviour change (plan 4 B2). Before: an ownerless realm was admitted and the
  // provider backstop refused mid-tool. After: a clear refusal up front, using no attempt.
  it('refuses a realm without a valid owner up front, without using up a grant attempt', () => {
    const now = Date.UTC(2026, 8, 28, 12);
    const unresolved = { namespaceId: 'ns-ownerless', userId: 'u', ownerUserId: null, attribution: 'unresolved' as const };
    for (let i = 0; i < 3; i++) {
      expect(runWithUsageContext(unresolved, () => admitPaidCall(principal('g-ownerless', 'ns-ownerless'), now))).toMatchObject({ ok: false, code: 'realm_owner_missing' });
    }
    expect(admitPaidCall(principal('g-ownerless', 'ns-open'), now)).toEqual({ ok: true });
    expect(admitPaidCall(principal('g-ownerless', 'ns-open'), now)).toEqual({ ok: true });
  });

  it('reports paid tools disabled before anything else', () => {
    process.env.MCP_DAILY_PAID_CALLS_PER_TOKEN = '0';
    resetConfigForTests();
    try {
      expect(admitPaidCall(principal('g-off', 'ns-free'))).toMatchObject({ ok: false, code: 'paid_tools_disabled' });
    } finally {
      process.env.MCP_DAILY_PAID_CALLS_PER_TOKEN = '2';
      resetConfigForTests();
    }
  });
});
