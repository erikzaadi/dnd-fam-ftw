import { describe, expect, it } from 'vitest';
import { normalizeEncounterSeeds } from './encounterSeeds.js';

const goodSeed = {
  name: 'Thornwood Guardian',
  triggerHint: 'when the party enters the Thornwood',
  enemies: [{ name: 'Vine Beast', role: 'standard', avatarUrl: 'https://img/vine.png' }],
  areas: [{ label: 'Writhing Roots', tags: ['hazard'], imageUrl: 'https://img/roots.png' }],
};

describe('normalizeEncounterSeeds', () => {
  it('gives a seed without areas an empty areas list', () => {
    const { areas: _areas, ...noAreas } = goodSeed;
    expect(normalizeEncounterSeeds([noAreas])?.[0].areas).toEqual([]);
  });

  it('keeps valid siblings and drops malformed seeds', () => {
    const seeds = normalizeEncounterSeeds([
      goodSeed,
      { ...goodSeed, name: 'No Enemies', enemies: undefined },
      { ...goodSeed, name: 'Empty Enemies', enemies: [] },
      { ...goodSeed, name: '  ' },
      { ...goodSeed, name: 'Bad Role', enemies: [{ name: 'X', role: 'dragon' }] },
      { ...goodSeed, name: 'Nameless Enemy', enemies: [{ name: '', role: 'boss' }] },
      'not a seed',
    ]);
    expect(seeds?.map(seed => seed.name)).toEqual(['Thornwood Guardian']);
  });

  it('keeps stored picture urls', () => {
    const [seed] = normalizeEncounterSeeds([goodSeed])!;
    expect(seed.enemies[0].avatarUrl).toBe('https://img/vine.png');
    expect(seed.areas[0].imageUrl).toBe('https://img/roots.png');
  });

  it('parses at most four seeds', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...goodSeed, name: `Seed ${i}` }));
    expect(normalizeEncounterSeeds(many)).toHaveLength(4);
  });

  it('returns null for non-arrays and when nothing is usable', () => {
    expect(normalizeEncounterSeeds({ name: 'oops' })).toBeNull();
    expect(normalizeEncounterSeeds([{ name: 'no enemies' }])).toBeNull();
  });
});
