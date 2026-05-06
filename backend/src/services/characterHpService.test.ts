import { describe, expect, it } from 'vitest';
import { getStartingMaxHp } from './characterHpService.js';

describe('getStartingMaxHp', () => {
  it.each([
    'Barbarian',
    'Warrior',
    'Paladin',
    'Death Knight',
    'Fighter',
    'Goblin Tank',
  ])('gives tank class %s 12 max HP', (characterClass) => {
    expect(getStartingMaxHp(characterClass)).toBe(12);
  });

  it.each([
    'Sorcerer',
    'Rogue',
    'Bard',
    'Cleric',
  ])('keeps non-tank class %s at 10 max HP', (characterClass) => {
    expect(getStartingMaxHp(characterClass)).toBe(10);
  });
});
