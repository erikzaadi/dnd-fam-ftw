// In-memory per-key limit: at most `max` hits within the last `windowMs`. The backend is
// a single process, so a restart only resets the windows.
export const createSlidingWindowLimiter = (windowMs: number, max: number) => {
  const hits = new Map<string, number[]>();
  return {
    // Counts this hit and returns true, or returns false when the key is at its limit.
    take(key: string, now: number = Date.now()): boolean {
      // Keys whose last hit left the window carry no state; drop them so the map stays small.
      for (const [other, times] of hits) {
        if (now - times[times.length - 1] >= windowMs) {
          hits.delete(other);
        }
      }
      const recent = (hits.get(key) ?? []).filter(time => now - time < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      hits.set(key, [...recent, now]);
      return true;
    },
    size: (): number => hits.size,
    clear: (): void => hits.clear(),
  };
};
