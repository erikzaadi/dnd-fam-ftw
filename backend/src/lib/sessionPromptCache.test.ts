import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSessionPromptCache,
  setSessionPromptCache,
  invalidateSessionPromptCache,
  clearSessionPromptCacheForTest,
  type CachedStablePartyMember,
  type CachedInventoryItem,
} from './sessionPromptCache.js';

const makeParty = (): CachedStablePartyMember[] => [
  {
    name: 'Pip',
    class: 'Rogue',
    species: 'Halfling',
    maxHp: 10,
    stats: { might: 1, magic: 2, mischief: 4 },
    quirk: 'Always hungry',
  },
];

const makeInventory = (): CachedInventoryItem[] => [
  {
    ownerName: 'Pip',
    name: '🗡️ Dagger',
    description: 'A small sharp blade.',
    statBonuses: { mischief: 1 },
  },
];

beforeEach(() => {
  clearSessionPromptCacheForTest();
  vi.useRealTimers();
});

describe('getSessionPromptCache', () => {
  it('returns null on miss', () => {
    expect(getSessionPromptCache('s1', 'pv1', 'iv1')).toBeNull();
  });

  it('returns cached data on hit with matching versions', () => {
    const party = makeParty();
    const inventory = makeInventory();
    setSessionPromptCache('s1', 'pv1', 'iv1', party, inventory);
    const hit = getSessionPromptCache('s1', 'pv1', 'iv1');
    expect(hit).not.toBeNull();
    expect(hit!.stableParty).toEqual(party);
    expect(hit!.inventory).toEqual(inventory);
  });

  it('returns null when partyVersion changes', () => {
    setSessionPromptCache('s1', 'pv1', 'iv1', makeParty(), makeInventory());
    expect(getSessionPromptCache('s1', 'pv2', 'iv1')).toBeNull();
  });

  it('returns null when inventoryVersion changes', () => {
    setSessionPromptCache('s1', 'pv1', 'iv1', makeParty(), makeInventory());
    expect(getSessionPromptCache('s1', 'pv1', 'iv2')).toBeNull();
  });

  it('survives ordinary turn updates (same versions, new get call)', () => {
    setSessionPromptCache('s1', 'pv1', 'iv1', makeParty(), makeInventory());
    // Simulates multiple turns without stable source changes
    expect(getSessionPromptCache('s1', 'pv1', 'iv1')).not.toBeNull();
    expect(getSessionPromptCache('s1', 'pv1', 'iv1')).not.toBeNull();
    expect(getSessionPromptCache('s1', 'pv1', 'iv1')).not.toBeNull();
  });

  it('returns null after TTL expires', () => {
    vi.useFakeTimers();
    setSessionPromptCache('s1', 'pv1', 'iv1', makeParty(), makeInventory());
    vi.advanceTimersByTime(26 * 60 * 1000); // 26 minutes
    expect(getSessionPromptCache('s1', 'pv1', 'iv1')).toBeNull();
  });

  it('resets TTL on each cache hit', () => {
    vi.useFakeTimers();
    setSessionPromptCache('s1', 'pv1', 'iv1', makeParty(), makeInventory());
    vi.advanceTimersByTime(20 * 60 * 1000); // 20 min - not expired
    getSessionPromptCache('s1', 'pv1', 'iv1'); // touch / refresh
    vi.advanceTimersByTime(20 * 60 * 1000); // 20 more min - would expire from original but not from refresh
    expect(getSessionPromptCache('s1', 'pv1', 'iv1')).not.toBeNull();
  });
});

describe('invalidateSessionPromptCache', () => {
  it('removes the entry', () => {
    setSessionPromptCache('s1', 'pv1', 'iv1', makeParty(), makeInventory());
    invalidateSessionPromptCache('s1');
    expect(getSessionPromptCache('s1', 'pv1', 'iv1')).toBeNull();
  });

  it('is a no-op for unknown sessions', () => {
    expect(() => invalidateSessionPromptCache('unknown')).not.toThrow();
  });
});

describe('LRU eviction', () => {
  it('evicts oldest entry when over capacity', () => {
    // Fill cache beyond the max (75) - we test behavior by filling 76 entries
    const MAX = 75;
    for (let i = 0; i < MAX; i++) {
      setSessionPromptCache(`s${i}`, 'pv', 'iv', makeParty(), makeInventory());
    }
    // s0 is oldest
    expect(getSessionPromptCache('s0', 'pv', 'iv')).not.toBeNull();
    // Access s0 to make it recently used, then s1 becomes oldest
    // Reset and fill without touching s0
    clearSessionPromptCacheForTest();
    for (let i = 0; i < MAX; i++) {
      setSessionPromptCache(`s${i}`, 'pv', 'iv', makeParty(), makeInventory());
    }
    // Add one more to trigger eviction - s0 (first inserted) should be evicted
    setSessionPromptCache('overflow', 'pv', 'iv', makeParty(), makeInventory());
    expect(getSessionPromptCache('s0', 'pv', 'iv')).toBeNull();
    expect(getSessionPromptCache('overflow', 'pv', 'iv')).not.toBeNull();
  });
});

describe('output shape preservation on cache miss', () => {
  it('returns correct structure after version mismatch fallback', () => {
    const party = makeParty();
    const inventory = makeInventory();
    setSessionPromptCache('s1', 'pv1', 'iv1', party, inventory);

    // Version change = cache miss
    const miss = getSessionPromptCache('s1', 'pv2', 'iv1');
    expect(miss).toBeNull();

    // Caller should rebuild and store new version
    setSessionPromptCache('s1', 'pv2', 'iv1', party, inventory);
    const hit = getSessionPromptCache('s1', 'pv2', 'iv1');
    expect(hit!.stableParty).toEqual(party);
    expect(hit!.inventory).toEqual(inventory);
  });
});
