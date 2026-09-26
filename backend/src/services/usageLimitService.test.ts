import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { usageRepository } from '../repositories/usageRepository.js';
import { checkPictureBudget, checkTextBudget, getDailyUsage, getEffectiveLimits, getTierLimits } from './usageLimitService.js';

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
  getDb().prepare("INSERT INTO namespaces (id, name, tier) VALUES ('ns-free', 'Free', 'free'), ('ns-old', 'Old', 'unlimited')").run();
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
});
