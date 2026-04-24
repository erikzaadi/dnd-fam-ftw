import { describe, it, expect } from 'vitest';
import { SPECIAL_TURNS } from './specialTurns';

describe('SPECIAL_TURNS', () => {
  it('has entries for intervention and sanctuary', () => {
    expect(SPECIAL_TURNS['intervention']).toBeDefined();
    expect(SPECIAL_TURNS['sanctuary']).toBeDefined();
  });

  it('each entry has img, label, borderClass, textClass', () => {
    for (const [, cfg] of Object.entries(SPECIAL_TURNS)) {
      expect(cfg.img).toMatch(/^\/images\//);
      expect(cfg.label).toBeTruthy();
      expect(cfg.borderClass).toMatch(/border-/);
      expect(cfg.textClass).toMatch(/text-/);
    }
  });

  it('intervention and sanctuary have different border colors', () => {
    expect(SPECIAL_TURNS['intervention'].borderClass).not.toBe(SPECIAL_TURNS['sanctuary'].borderClass);
  });
});
