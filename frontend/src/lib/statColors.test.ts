import { describe, it, expect } from 'vitest';
import { STAT_COLORS } from './statColors';

describe('STAT_COLORS', () => {
  it('has entries for all three stats and none', () => {
    expect(STAT_COLORS['might']).toBeDefined();
    expect(STAT_COLORS['magic']).toBeDefined();
    expect(STAT_COLORS['mischief']).toBeDefined();
    expect(STAT_COLORS['none']).toBeDefined();
  });

  it('each entry contains border, bg, and text classes', () => {
    for (const [, classes] of Object.entries(STAT_COLORS)) {
      expect(classes).toMatch(/border-/);
      expect(classes).toMatch(/bg-/);
      expect(classes).toMatch(/text-/);
    }
  });

  it('stat colors are visually distinct', () => {
    expect(STAT_COLORS['might']).toContain('rose');
    expect(STAT_COLORS['magic']).toContain('blue');
    expect(STAT_COLORS['mischief']).toContain('purple');
  });
});
