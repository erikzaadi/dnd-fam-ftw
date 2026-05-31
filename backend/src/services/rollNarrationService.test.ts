import { describe, it, expect } from 'vitest';
import { buildRollNarration } from './rollNarrationService.js';
import type { ActionAttempt } from '../types.js';

type ActionResult = ActionAttempt['actionResult'];

const makeResult = (overrides: Partial<ActionResult> = {}): ActionResult => ({
  success: true,
  roll: 12,
  statUsed: 'might',
  impact: 'normal',
  difficultyTarget: 12,
  ...overrides,
});

describe('buildRollNarration', () => {
  it('returns empty string for statUsed=none', () => {
    expect(buildRollNarration(makeResult({ statUsed: 'none' }))).toBe('');
  });

  it('returns empty string for undefined statUsed', () => {
    const result = makeResult({ statUsed: undefined as unknown as 'none' });
    expect(buildRollNarration(result)).toBe('');
  });

  it('returns a nat-20 phrase on roll=20 regardless of stat', () => {
    const r = buildRollNarration(makeResult({ roll: 20, statUsed: 'mischief', success: true }));
    expect(r.length).toBeGreaterThan(0);
    expect(r).toMatch(/twenty|twenty|twenty/i);
  });

  describe('all stat + outcome + impact combinations return a non-empty string', () => {
    const stats = ['might', 'magic', 'mischief'] as const;
    const outcomes = [true, false];
    const impacts = ['extreme', 'strong', 'normal'] as const;

    for (const stat of stats) {
      for (const success of outcomes) {
        for (const impact of impacts) {
          it(`stat=${stat} success=${success} impact=${impact}`, () => {
            const r = buildRollNarration(makeResult({ statUsed: stat, success, impact, roll: 10 }));
            expect(r.length).toBeGreaterThan(0);
          });
        }
      }
    }
  });

  it('low raw roll with successful total reads as success phrase', () => {
    // roll=3, but action succeeded (high bonuses pushed it over)
    const r = buildRollNarration(makeResult({ roll: 3, success: true, statUsed: 'might', impact: 'normal' }));
    expect(r).not.toMatch(/fail|misstep|misfir|fizzle|fumble/i);
  });

  it('natural 1 failure returns a failure phrase', () => {
    const r = buildRollNarration(makeResult({ roll: 1, success: false, statUsed: 'magic', impact: 'extreme' }));
    expect(r.length).toBeGreaterThan(0);
    // nat 1 should NOT trigger the nat-20 branch
    expect(r).not.toMatch(/twenty/i);
  });

  it('returns fallback string for unknown stat', () => {
    const r = buildRollNarration(makeResult({ statUsed: 'unknown_stat' as 'might', success: true }));
    expect(r).toBe('Success!');
  });
});
