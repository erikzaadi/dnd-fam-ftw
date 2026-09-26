import { hashOperationPayload } from '../services/sessionOperationService.js';

// Short-lived request dedup for preview_action. A host that retries a preview after a
// timeout gets the first attempt's result instead of paying for a second
// interpretation. Same request id with a different draft is a conflict.
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 1000;

type Entry<T> = { payloadHash: string; result: Promise<T>; createdAt: number };
const entries = new Map<string, Entry<unknown>>();

export type DedupOutcome<T> = { type: 'result'; result: Promise<T>; replayed: boolean } | { type: 'conflict' };

const prune = (now: number): void => {
  for (const [key, entry] of entries) {
    if (now - entry.createdAt > TTL_MS || entries.size > MAX_ENTRIES) {
      entries.delete(key);
    } else {
      break;
    }
  }
};

export const dedupPreview = <T>(key: string, payload: unknown, run: () => Promise<T>, now: number = Date.now()): DedupOutcome<T> => {
  prune(now);
  const payloadHash = hashOperationPayload(payload);
  const existing = entries.get(key) as Entry<T> | undefined;
  if (existing) {
    return existing.payloadHash === payloadHash ? { type: 'result', result: existing.result, replayed: true } : { type: 'conflict' };
  }
  const result = run();
  entries.set(key, { payloadHash, result, createdAt: now });
  // A failed attempt may be retried with the same id.
  result.catch(() => entries.delete(key));
  return { type: 'result', result, replayed: false };
};

export const clearPreviewDedupForTests = (): void => {
  entries.clear();
};
