import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { usageRepository } from '../repositories/usageRepository.js';
import { admitPaidWork, checkAdventureCap, paidWorkRefusalStatus, refusalStatus } from './paidWorkAdmission.js';
import { getTierLimits } from './usageLimitService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-paid-work-test-${Date.now()}.sqlite`);

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  initializeDatabase();
  getDb().prepare("INSERT INTO namespaces (id, name, tier) VALUES ('ns-spent', 'Spent', 'free'), ('ns-fresh', 'Fresh', 'free')").run();
  for (let i = 0; i < getTierLimits('free').textCreditsPerDay!; i++) {
    usageRepository.recordProviderUsage({
      namespaceId: 'ns-spent', userId: null, ownerUserId: null, attribution: 'system', sessionId: null, kind: 'text', endpoint: '/test', model: null,
      inputTokens: null, outputTokens: null, ttsCharacters: null, imageCount: null, success: true, estimatedCostUsd: 0.001,
    });
  }
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

describe('admitPaidWork', () => {
  it('admits a realm with budget left', () => {
    expect(admitPaidWork('website', { namespaceId: 'ns-fresh', attribution: 'verified' })).toEqual({ ok: true });
  });

  it('refuses a spent text budget with the limit response, as 429', () => {
    const admission = admitPaidWork('website', { namespaceId: 'ns-spent', attribution: 'verified' });
    expect(admission).toMatchObject({ ok: false, refusal: { error: 'limit_reached', kind: 'text', tier: 'free' } });
    expect(!admission.ok && paidWorkRefusalStatus(admission.refusal)).toBe(429);
  });

  it('refuses an ownerless realm first on the website, as 503', () => {
    const admission = admitPaidWork('website', { namespaceId: 'ns-spent', attribution: 'unresolved' });
    expect(admission).toMatchObject({ ok: false, refusal: { error: 'realm_owner_missing' } });
    expect(!admission.ok && paidWorkRefusalStatus(admission.refusal)).toBe(503);
  });

  it('leaves an ownerless realm to the backstop for read-aloud', () => {
    expect(admitPaidWork('tts', { namespaceId: 'ns-fresh', attribution: 'unresolved' })).toEqual({ ok: true });
  });

  it('refuses an ownerless realm up front for assistant tools', () => {
    expect(admitPaidWork('assistant', { namespaceId: 'ns-fresh', attribution: 'unresolved' })).toMatchObject({ ok: false, refusal: { error: 'realm_owner_missing' } });
  });

  it('maps every refusal code to one status', () => {
    expect(['limit_reached', 'token_daily_limit', 'session_limit', 'realm_owner_missing', 'paid_tools_disabled'].map(refusalStatus)).toEqual([429, 429, 403, 503, 503]);
  });
});

describe('checkAdventureCap', () => {
  it('refuses once the realm holds its cap of adventures, and never without a cap', () => {
    expect(checkAdventureCap('ns-fresh')).toBeNull();
    namespaceRepository.setNamespaceLimits('ns-fresh', 0, null);
    expect(checkAdventureCap('ns-fresh')).toMatchObject({ error: 'session_limit', limit: 0 });
    namespaceRepository.setNamespaceLimits('ns-fresh', null, null);
    expect(checkAdventureCap('local')).toBeNull();
  });
});
