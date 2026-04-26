import { describe, it, expect } from 'vitest';
import { getSessionEntryPath } from './sessionRoute';

const makeSession = (partyCount: number, gameOver?: boolean) => ({
  id: 'sess-1',
  gameOver,
  party: Array.from({ length: partyCount }, (_, i) => ({
    id: `hero-${i}`,
    name: 'Hero',
    class: 'Warrior',
    species: 'Human',
    hp: 10,
    max_hp: 10,
  })),
});

describe('getSessionEntryPath', () => {
  it('routes to assembly when party is empty', () => {
    expect(getSessionEntryPath(makeSession(0))).toBe('/session/sess-1/assembly');
  });

  it('routes to recap when party has members', () => {
    expect(getSessionEntryPath(makeSession(1))).toBe('/session/sess-1/recap');
  });

  it('routes to recap when party has multiple members', () => {
    expect(getSessionEntryPath(makeSession(3))).toBe('/session/sess-1/recap');
  });

  it('routes to session root when game is over', () => {
    expect(getSessionEntryPath(makeSession(2, true))).toBe('/session/sess-1');
  });

  it('routes to assembly when party is empty even if gameOver somehow set', () => {
    expect(getSessionEntryPath(makeSession(0, true))).toBe('/session/sess-1/assembly');
  });
});
