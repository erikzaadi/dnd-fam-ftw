import { describe, it, expect } from 'vitest';
import { StorySummaryService } from './storySummaryService.js';

describe('StorySummaryService.shouldUpdate', () => {
  it('returns false at turn 0', () => {
    expect(StorySummaryService.shouldUpdate(0)).toBe(false);
  });

  it('returns false at turn 1', () => {
    expect(StorySummaryService.shouldUpdate(1)).toBe(false);
  });

  it('returns false for turns 2-4', () => {
    for (const t of [2, 3, 4]) {
      expect(StorySummaryService.shouldUpdate(t)).toBe(false);
    }
  });

  it('returns true at turn 5', () => {
    expect(StorySummaryService.shouldUpdate(5)).toBe(true);
  });

  it('returns true at subsequent interval turns (10, 15, 20)', () => {
    for (const t of [10, 15, 20]) {
      expect(StorySummaryService.shouldUpdate(t)).toBe(true);
    }
  });

  it('returns false between interval turns', () => {
    for (const t of [6, 7, 8, 9, 11, 13]) {
      expect(StorySummaryService.shouldUpdate(t)).toBe(false);
    }
  });
});
