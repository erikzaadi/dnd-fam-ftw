import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetConfigForTests } from '../config/env.js';
import { runWithUsageContext } from '../lib/usageContext.js';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { usageRepository } from '../repositories/usageRepository.js';
import { checkPictureBudget, checkProviderAdmission, checkTextBudget, getDailyUsage, getEffectiveLimits, getTierLimits } from './usageLimitService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-usage-limits-test-${Date.now()}.sqlite`);

const recordCalls = (namespaceId: string, kind: 'text' | 'image' | 'tts', count: number, ttsCharacters: number | null = null) => {
  for (let i = 0; i < count; i++) {
    usageRepository.recordProviderUsage({
      namespaceId, userId: null, ownerUserId: null, attribution: 'system', sessionId: null, kind, endpoint: '/test', model: null,
      inputTokens: null, outputTokens: null, ttsCharacters, imageCount: kind === 'image' ? 1 : null,
      success: true, estimatedCostUsd: 0.001,
    });
  }
};

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  initializeDatabase();
  getDb().prepare("INSERT INTO namespaces (id, name, tier) VALUES ('ns-free', 'Free', 'free'), ('ns-old', 'Old', 'unlimited'), ('ns-sup', 'Supporter', 'supporter')").run();
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

describe('usageLimitService', () => {
  it('treats existing namespaces (including local) as unlimited', () => {
    expect(getEffectiveLimits('local').tier).toBe('unlimited');
    expect(getEffectiveLimits('local').maxSessions).toBeNull();
  });

  it('applies per-namespace overrides on top of tier defaults', () => {
    expect(getEffectiveLimits('ns-free').maxSessions).toBe(getTierLimits('free').maxSessions);
    namespaceRepository.setNamespaceLimits('ns-free', 7, null);
    expect(getEffectiveLimits('ns-free').maxSessions).toBe(7);
    expect(getEffectiveLimits('ns-free').maxTurns).toBe(getTierLimits('free').maxTurns);
    namespaceRepository.setNamespaceLimits('ns-free', null, null);
  });

  it('counts TTS characters as text credits', () => {
    recordCalls('ns-free', 'tts', 1, 1500);
    expect(getDailyUsage('ns-free').textCredits).toBe(2);
  });

  it('refuses text once the free daily budget is spent, but never for unlimited', () => {
    const limit = getTierLimits('free').textCreditsPerDay!;
    expect(checkTextBudget('ns-free')).toBeNull();
    recordCalls('ns-free', 'text', limit);
    recordCalls('ns-old', 'text', limit + 5);
    expect(checkTextBudget('ns-free')).toMatchObject({ error: 'limit_reached', kind: 'text', tier: 'free' });
    expect(checkTextBudget('ns-old')).toBeNull();
  });

  it('allows the backstop margin beyond the route limit', () => {
    expect(checkTextBudget('ns-free', { factor: 1.2 })).toBeNull();
  });

  it('refuses pictures once the daily picture budget is spent', () => {
    expect(checkPictureBudget('ns-free')).toBeNull();
    recordCalls('ns-free', 'image', getTierLimits('free').picturesPerDay!);
    expect(checkPictureBudget('ns-free')).toMatchObject({ kind: 'pictures' });
  });

  it('resets on the next UTC day', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(checkTextBudget('ns-free', { now: tomorrow })).toBeNull();
  });

  // Characterization (architecture-deepening plan 4).
  it('lets a request through when the usage lookup fails at the backstop', () => {
    const spy = vi.spyOn(usageRepository, 'getNamespaceUsageSince').mockImplementation(() => {
      throw new Error('database is locked');
    });
    try {
      const context = { namespaceId: 'ns-free', userId: null, ownerUserId: null, attribution: 'system' as const };
      expect(runWithUsageContext(context, () => checkProviderAdmission('text'))).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('never refuses work outside a request at the backstop', () => {
    expect(checkProviderAdmission('text')).toBeNull();
  });

  it('stops pictures for free and supporter realms past the global soft threshold, and free text past the hard one', () => {
    process.env.DAILY_SPEND_LIMIT_USD = '0.000001';
    resetConfigForTests();
    try {
      expect(checkPictureBudget('ns-sup')).toMatchObject({ kind: 'pictures', tier: 'supporter' });
      expect(checkPictureBudget('ns-old')).toBeNull();
      expect(checkTextBudget('ns-free', { now: new Date() })).toMatchObject({ kind: 'text', message: expect.stringContaining('resting') });
      expect(checkTextBudget('ns-sup')).toBeNull();
      expect(checkTextBudget('ns-old')).toBeNull();
    } finally {
      delete process.env.DAILY_SPEND_LIMIT_USD;
      resetConfigForTests();
    }
  });
});
