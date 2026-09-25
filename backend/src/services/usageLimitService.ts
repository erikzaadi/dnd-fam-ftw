import { getConfig } from '../config/env.js';
import { getUsageContext } from '../lib/usageContext.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { usageRepository } from '../repositories/usageRepository.js';
import type { LimitReachedResponse, UsageLimitKind, UsageTier } from '../types.js';

export const USAGE_TIERS: readonly UsageTier[] = ['free', 'supporter', 'unlimited'];

export interface TierLimits {
  textCreditsPerDay: number | null;
  picturesPerDay: number | null;
  maxSessions: number | null;
  maxTurns: number | null;
}

export interface EffectiveLimits extends TierLimits {
  tier: UsageTier;
  // Epoch ms when a time-limited tier falls back to free; null if it never does.
  tierExpiresAt: number | null;
}

export interface DailyUsage {
  textCredits: number;
  pictures: number;
  estimatedCostUsd: number;
}

// Starting points, not measured requirements. Override per tier with
// USAGE_TIER_LIMITS='{"free":{"picturesPerDay":30}}'. null = unlimited.
const DEFAULT_TIER_LIMITS: Record<UsageTier, TierLimits> = {
  free: { textCreditsPerDay: 150, picturesPerDay: 20, maxSessions: 3, maxTurns: 100 },
  supporter: { textCreditsPerDay: 600, picturesPerDay: 150, maxSessions: 15, maxTurns: null },
  unlimited: { textCreditsPerDay: null, picturesPerDay: null, maxSessions: null, maxTurns: null },
};

// TTS counts as text credits: one credit per started 1000 characters.
const TTS_CHARACTERS_PER_CREDIT = 1000;
// Route checks stop new work at the limit. The provider-level backstop allows this much
// extra so in-flight turns can finish, while still capping any unguarded path.
const BACKSTOP_FACTOR = 1.2;
// Past this multiple of DAILY_SPEND_LIMIT_USD, text is refused for free namespaces too.
const HARD_SPEND_FACTOR = 2;

const TIER_LABELS: Record<UsageTier, string> = {
  free: 'Adventurer',
  supporter: 'Patron of the Realm',
  unlimited: 'Founding Realm',
};

export const isUsageTier = (value: unknown): value is UsageTier =>
  typeof value === 'string' && (USAGE_TIERS as readonly string[]).includes(value);

export const tierLabel = (tier: UsageTier): string => TIER_LABELS[tier];

let tierOverrides: Partial<Record<UsageTier, Partial<TierLimits>>> | null = null;

function getTierOverrides(): Partial<Record<UsageTier, Partial<TierLimits>>> {
  if (tierOverrides) {
    return tierOverrides;
  }
  tierOverrides = {};
  const raw = process.env.USAGE_TIER_LIMITS?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      for (const [tier, limits] of Object.entries(parsed)) {
        if (!isUsageTier(tier) || !limits || typeof limits !== 'object') {
          continue;
        }
        const clean: Partial<TierLimits> = {};
        for (const key of Object.keys(DEFAULT_TIER_LIMITS.free) as (keyof TierLimits)[]) {
          const value = limits[key];
          if (value === null || (typeof value === 'number' && value >= 0)) {
            clean[key] = value;
          }
        }
        tierOverrides[tier] = clean;
      }
    } catch {
      console.warn('[Usage] Ignoring invalid USAGE_TIER_LIMITS JSON');
    }
  }
  return tierOverrides;
}

export function getTierLimits(tier: UsageTier): TierLimits {
  return { ...DEFAULT_TIER_LIMITS[tier], ...getTierOverrides()[tier] };
}

export function getNamespaceTier(namespaceId: string, now: number = Date.now()): UsageTier {
  const record = namespaceRepository.getNamespaceTier(namespaceId);
  if (!record || !isUsageTier(record.tier)) {
    return 'unlimited';
  }
  // A time-limited upgrade (Ko-fi donation) falls back to free once it runs out.
  if (record.expiresAt !== null && record.expiresAt <= now) {
    return 'free';
  }
  return record.tier;
}

// Per-namespace max_sessions / max_turns (set via CLI) override the tier defaults.
export function getEffectiveLimits(namespaceId: string): EffectiveLimits {
  const tier = getNamespaceTier(namespaceId);
  const tierLimits = getTierLimits(tier);
  const overrides = namespaceRepository.getNamespaceLimits(namespaceId);
  const expiresAt = namespaceRepository.getNamespaceTier(namespaceId)?.expiresAt ?? null;
  return {
    tier,
    tierExpiresAt: tier === 'free' ? null : expiresAt,
    ...tierLimits,
    maxSessions: overrides.maxSessions ?? tierLimits.maxSessions,
    maxTurns: overrides.maxTurns ?? tierLimits.maxTurns,
  };
}

export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function nextUtcReset(now: Date = new Date()): Date {
  return new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000);
}

export function getDailyUsage(namespaceId: string, now: Date = new Date()): DailyUsage {
  const totals = usageRepository.getNamespaceUsageSince(namespaceId, startOfUtcDay(now));
  return {
    textCredits: totals.textCalls + Math.ceil(totals.ttsCharacters / TTS_CHARACTERS_PER_CREDIT),
    pictures: totals.imageCalls,
    estimatedCostUsd: totals.estimatedCostUsd,
  };
}

export interface GlobalSpendState {
  limitUsd: number | null;
  spentTodayUsd: number;
  // Pictures stop for free/supporter and new signups pause.
  softExceeded: boolean;
  // Text stops for free namespaces too.
  hardExceeded: boolean;
}

let lastSpendAlertDay: string | null = null;

export function getGlobalSpendState(now: Date = new Date()): GlobalSpendState {
  const limitUsd = getConfig().DAILY_SPEND_LIMIT_USD;
  if (limitUsd === null) {
    return { limitUsd, spentTodayUsd: 0, softExceeded: false, hardExceeded: false };
  }
  const spentTodayUsd = usageRepository.getTotalUsageSince(startOfUtcDay(now)).estimatedCostUsd;
  const softExceeded = spentTodayUsd >= limitUsd;
  if (softExceeded) {
    const day = startOfUtcDay(now).toISOString().slice(0, 10);
    if (lastSpendAlertDay !== day) {
      lastSpendAlertDay = day;
      console.error(`[Usage] Daily spend limit reached: estimated $${spentTodayUsd.toFixed(2)} of $${limitUsd.toFixed(2)}. Pictures and new signups are paused until 00:00 UTC.`);
    }
  }
  return { limitUsd, spentTodayUsd, softExceeded, hardExceeded: spentTodayUsd >= limitUsd * HARD_SPEND_FACTOR };
}

export function isSignupPaused(now: Date = new Date()): boolean {
  return getGlobalSpendState(now).softExceeded;
}

const limitReached = (kind: UsageLimitKind, tier: UsageTier, message: string, resetsAt: Date | null): LimitReachedResponse => ({
  error: 'limit_reached',
  kind,
  tier,
  message,
  resetsAt: resetsAt ? resetsAt.toISOString() : null,
});

interface CheckOptions {
  // Multiplier on the per-namespace daily limit (backstop use).
  factor?: number;
  now?: Date;
}

export function checkTextBudget(namespaceId: string, { factor = 1, now = new Date() }: CheckOptions = {}): LimitReachedResponse | null {
  const limits = getEffectiveLimits(namespaceId);
  if (limits.tier === 'unlimited') {
    return null;
  }
  const resetsAt = nextUtcReset(now);
  if (limits.tier === 'free' && getGlobalSpendState(now).hardExceeded) {
    return limitReached('text', limits.tier, 'The realm is resting for today. Come back tomorrow for more adventures.', resetsAt);
  }
  if (limits.textCreditsPerDay === null) {
    return null;
  }
  if (getDailyUsage(namespaceId, now).textCredits >= limits.textCreditsPerDay * factor) {
    return limitReached('text', limits.tier, "Your party's adventure energy is spent for today. It returns at midnight UTC.", resetsAt);
  }
  return null;
}

export function checkPictureBudget(namespaceId: string, { factor = 1, now = new Date() }: CheckOptions = {}): LimitReachedResponse | null {
  const limits = getEffectiveLimits(namespaceId);
  if (limits.tier === 'unlimited') {
    return null;
  }
  const resetsAt = nextUtcReset(now);
  if (getGlobalSpendState(now).softExceeded) {
    return limitReached('pictures', limits.tier, "The realm's painters are resting until tomorrow.", resetsAt);
  }
  if (limits.picturesPerDay === null) {
    return null;
  }
  if (getDailyUsage(namespaceId, now).pictures >= limits.picturesPerDay * factor) {
    return limitReached('pictures', limits.tier, "The realm's painters are resting until tomorrow.", resetsAt);
  }
  return null;
}

// Provider-level backstop for the current request's namespace. Work outside a request
// (scripts, startup) is never refused.
export function checkProviderAdmission(kind: 'text' | 'image' | 'tts'): LimitReachedResponse | null {
  const namespaceId = getUsageContext()?.namespaceId;
  if (!namespaceId) {
    return null;
  }
  try {
    return kind === 'image'
      ? checkPictureBudget(namespaceId)
      : checkTextBudget(namespaceId, { factor: BACKSTOP_FACTOR });
  } catch (err) {
    // A broken usage lookup must not take the game down.
    console.warn(`[Usage] Admission check failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// Picture check for the current request's namespace, used to skip image work early.
export function currentPictureBudgetExhausted(): boolean {
  return checkProviderAdmission('image') !== null;
}
