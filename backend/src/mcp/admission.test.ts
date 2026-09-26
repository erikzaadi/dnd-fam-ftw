import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { usageRepository } from '../repositories/usageRepository.js';
import type { McpPrincipal } from '../services/accessTokenService.js';
import { getTierLimits } from '../services/usageLimitService.js';
import { admitPaidCall } from './admission.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-mcp-admission-test-${Date.now()}.sqlite`);

const principal = (tokenId: string, namespaceId: string): McpPrincipal => ({
  tokenId, userId: 'u', email: 'e@example.com', namespaceId, scopes: ['adventures:read', 'adventures:play'], expiresAt: Date.now() + 1000,
});

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.MCP_DAILY_PAID_CALLS_PER_TOKEN = '2';
  initializeDatabase();
  getDb().prepare("INSERT INTO namespaces (id, name, tier) VALUES ('ns-free', 'Free', 'free'), ('ns-open', 'Open', 'unlimited')").run();
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
});
