import { describe, it, expect } from 'vitest';
import { pickRandomPartyArchetypes, pickWorldSeed, WORLD_SEEDS } from './instantStartArchetypes.js';
import { RANDOM_NAMES, RANDOM_QUIRKS } from '@dnd-fam-ftw/shared';

describe('pickRandomPartyArchetypes', () => {
  it('returns between 3 and 5 characters', () => {
    for (let i = 0; i < 20; i++) {
      const party = pickRandomPartyArchetypes();
      expect(party.length).toBeGreaterThanOrEqual(3);
      expect(party.length).toBeLessThanOrEqual(5);
    }
  });

  it('always includes at least one tank', () => {
    for (let i = 0; i < 20; i++) {
      const party = pickRandomPartyArchetypes();
      expect(party.some(c => c.role === 'tank')).toBe(true);
    }
  });

  it('always includes at least one healer', () => {
    for (let i = 0; i < 20; i++) {
      const party = pickRandomPartyArchetypes();
      expect(party.some(c => c.role === 'healer')).toBe(true);
    }
  });

  it('always includes at least one damage dealer', () => {
    for (let i = 0; i < 20; i++) {
      const party = pickRandomPartyArchetypes();
      expect(party.some(c => c.role === 'damage')).toBe(true);
    }
  });

  it('has no duplicate names within a party', () => {
    for (let i = 0; i < 20; i++) {
      const party = pickRandomPartyArchetypes();
      const names = party.map(c => c.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('has no duplicate quirks within a party', () => {
    for (let i = 0; i < 20; i++) {
      const party = pickRandomPartyArchetypes();
      const quirks = party.map(c => c.quirk);
      expect(new Set(quirks).size).toBe(quirks.length);
    }
  });

  it('assigns stats within valid range for all characters', () => {
    const party = pickRandomPartyArchetypes();
    for (const char of party) {
      expect(char.stats.might).toBeGreaterThanOrEqual(0);
      expect(char.stats.might).toBeLessThanOrEqual(5);
      expect(char.stats.magic).toBeGreaterThanOrEqual(0);
      expect(char.stats.magic).toBeLessThanOrEqual(5);
      expect(char.stats.mischief).toBeGreaterThanOrEqual(0);
      expect(char.stats.mischief).toBeLessThanOrEqual(5);
    }
  });

  it('assigns HP of 10 or 12 for all characters', () => {
    const party = pickRandomPartyArchetypes();
    for (const char of party) {
      expect([10, 12]).toContain(char.maxHp);
    }
  });

  it('uses names from the shared name pool', () => {
    const party = pickRandomPartyArchetypes();
    for (const char of party) {
      expect(RANDOM_NAMES).toContain(char.name);
    }
  });

  it('uses quirks from the shared quirks pool', () => {
    const party = pickRandomPartyArchetypes();
    for (const char of party) {
      expect(RANDOM_QUIRKS).toContain(char.quirk);
    }
  });

  it('gives tanks 12 max HP', () => {
    for (let i = 0; i < 20; i++) {
      const party = pickRandomPartyArchetypes();
      const tanks = party.filter(c => c.role === 'tank');
      for (const tank of tanks) {
        expect(tank.maxHp).toBe(12);
      }
    }
  });
});

describe('pickWorldSeed', () => {
  it('returns a seed from the WORLD_SEEDS pool', () => {
    for (let i = 0; i < 10; i++) {
      const seed = pickWorldSeed();
      expect(WORLD_SEEDS).toContainEqual(seed);
    }
  });

  it('returns a seed with non-empty displayName and worldDescription', () => {
    const seed = pickWorldSeed();
    expect(seed.displayName.length).toBeGreaterThan(0);
    expect(seed.worldDescription.length).toBeGreaterThan(0);
  });
});
