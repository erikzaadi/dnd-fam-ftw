import { devLog } from './devLog.js';

const MAX_ENTRIES = 75;
const TTL_MS = 25 * 60 * 1000; // 25 minutes

export type CachedStablePartyMember = {
  name: string;
  class: string;
  species: string;
  maxHp: number;
  stats: { might: number; magic: number; mischief: number };
  quirk?: string;
  gender?: string;
  history?: string;
};

export type CachedInventoryItem = {
  ownerName: string;
  name: string;
  description: string;
  statBonuses: { might?: number; magic?: number; mischief?: number };
  healValue?: number;
  consumable?: boolean;
  transferable?: boolean;
  tags?: string[];
  effect?: string;
  charges?: number;
  condition?: string;
  boundToCharacterName?: string;
};

type Entry = {
  partyVersion: string;
  inventoryVersion: string;
  stableParty: CachedStablePartyMember[];
  inventory: CachedInventoryItem[];
  lastAccessed: number;
};

// Map maintains insertion order - used for LRU eviction (first = oldest)
const store = new Map<string, Entry>();

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.lastAccessed > TTL_MS) {
      store.delete(key);
      devLog.log(`[PromptCache] evict sessionId=${key} reason=ttl`);
    }
  }
}

export type SessionPromptCacheHit = {
  stableParty: CachedStablePartyMember[];
  inventory: CachedInventoryItem[];
};

export function getSessionPromptCache(
  sessionId: string,
  partyVersion: string,
  inventoryVersion: string,
): SessionPromptCacheHit | null {
  const entry = store.get(sessionId);
  if (!entry) {
    devLog.log(`[PromptCache] miss sessionId=${sessionId} reason=not_found`);
    return null;
  }
  if (Date.now() - entry.lastAccessed > TTL_MS) {
    store.delete(sessionId);
    devLog.log(`[PromptCache] miss sessionId=${sessionId} reason=ttl_expired`);
    return null;
  }
  if (entry.partyVersion !== partyVersion || entry.inventoryVersion !== inventoryVersion) {
    devLog.log(`[PromptCache] miss sessionId=${sessionId} reason=version_change`);
    return null;
  }
  // Re-insert to update LRU order
  store.delete(sessionId);
  entry.lastAccessed = Date.now();
  store.set(sessionId, entry);
  devLog.log(`[PromptCache] hit sessionId=${sessionId}`);
  return { stableParty: entry.stableParty, inventory: entry.inventory };
}

export function setSessionPromptCache(
  sessionId: string,
  partyVersion: string,
  inventoryVersion: string,
  stableParty: CachedStablePartyMember[],
  inventory: CachedInventoryItem[],
): void {
  if (store.size >= MAX_ENTRIES) {
    evictExpired();
    if (store.size >= MAX_ENTRIES) {
      const [oldestKey] = store.keys();
      store.delete(oldestKey);
      devLog.log(`[PromptCache] evict sessionId=${oldestKey} reason=lru`);
    }
  }
  store.set(sessionId, {
    partyVersion,
    inventoryVersion,
    stableParty,
    inventory,
    lastAccessed: Date.now(),
  });
}

export function invalidateSessionPromptCache(sessionId: string): void {
  if (store.delete(sessionId)) {
    devLog.log(`[PromptCache] invalidate sessionId=${sessionId}`);
  }
}

// Only for tests
export function clearSessionPromptCacheForTest(): void {
  store.clear();
}
