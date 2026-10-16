import { describe, expect, it } from 'vitest';
import { createSlidingWindowLimiter } from './slidingWindowLimiter.js';

describe('createSlidingWindowLimiter', () => {
  it('allows max hits per window and frees slots as they age out', () => {
    const limiter = createSlidingWindowLimiter(1000, 2);
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 500)).toBe(true);
    expect(limiter.take('a', 900)).toBe(false);
    expect(limiter.take('b', 900)).toBe(true);
    expect(limiter.take('a', 1000)).toBe(true);
  });

  it('forgets keys whose hits all left the window', () => {
    const limiter = createSlidingWindowLimiter(1000, 2);
    limiter.take('old', 0);
    limiter.take('new', 2000);
    expect(limiter.size()).toBe(1);
  });
});
