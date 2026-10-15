import { authChallengeRepository } from '../repositories/authChallengeRepository.js';

// Fixed-window limit shared by sign-in flows. Counts this call and returns the seconds
// until the window resets when the limit is exceeded, else null.
export function hitRateLimit(bucket: string, windowMs: number, limit: number, now: number): number | null {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const count = authChallengeRepository.incrementRateLimit(bucket, windowStart);
  return count > limit ? Math.ceil((windowStart + windowMs - now) / 1000) : null;
}
