import { describe, expect, it } from 'vitest';
import { computeChoiceOdds, calcSuccessProb, beatTarget } from './game';
import type { Character, Choice } from '../types';

const makeChar = (overrides: Partial<Character> = {}): Character => ({
  id: 'char-1',
  name: 'Pip',
  class: 'Rogue',
  species: 'Halfling',
  quirk: 'Sneaky',
  hp: 8,
  max_hp: 10,
  status: 'active',
  stats: { might: 4, magic: 1, mischief: 2 },
  inventory: [],
  ...overrides,
});

const makeChoice = (overrides: Partial<Choice> = {}): Choice => ({
  label: 'Attack',
  difficulty: 'normal',
  stat: 'might',
  ...overrides,
});

describe('calcSuccessProb', () => {
  it('computes the chance of beating the target on a d20', () => {
    // might 4 vs target 12 -> needs 8+ -> 13 of 20 faces -> 65%
    expect(calcSuccessProb(4, 12)).toBe(65);
  });

  it('caps at 100 when the total already beats the target', () => {
    expect(calcSuccessProb(20, 8)).toBe(100);
  });
});

describe('beatTarget', () => {
  it('uses difficultyValue when set, difficulty threshold otherwise', () => {
    expect(beatTarget(14, 'normal')).toBe(14);
    expect(beatTarget(undefined, 'easy')).toBe(8);
    expect(beatTarget(undefined, 'unknown')).toBe(12);
  });
});

describe('computeChoiceOdds', () => {
  it('computes base stats against the difficulty target', () => {
    const odds = computeChoiceOdds(makeChoice(), makeChar(), [makeChar()]);

    expect(odds.statTotal).toBe(4);
    expect(odds.target).toBe(12);
    expect(odds.prob).toBe(65);
    expect(odds.riskLabel).toBe('Risky');
    expect(odds.isRiddleAnswer).toBe(false);
  });

  it('adds gear and clamped buff bonuses', () => {
    const char = makeChar({
      inventory: [{ id: 'i1', name: 'Axe', description: 'Sharp', statBonuses: { might: 1 } }],
      buffs: [{ id: 'b1', name: 'Rage', description: 'Angry', statBonuses: { might: 5 } }],
    });

    const odds = computeChoiceOdds(makeChoice(), char, [char]);

    // 4 base + 1 gear + 3 (buff clamped from 5)
    expect(odds.statBonus).toBe(1);
    expect(odds.buffBonus).toBe(3);
    expect(odds.statTotal).toBe(8);
  });

  it('adds the helper bonus only when the named helper is active in the party', () => {
    const actor = makeChar();
    const helper = makeChar({ id: 'char-2', name: 'Zara' });
    const choice = makeChoice({ flavor: 'combo', helperCharacterName: 'Zara' });

    expect(computeChoiceOdds(choice, actor, [actor, helper]).helperBonus).toBe(2);
    expect(computeChoiceOdds(choice, actor, [actor, { ...helper, status: 'downed' }]).helperBonus).toBe(0);
  });

  it('labels easy choices Favorable and hard choices Tough', () => {
    expect(computeChoiceOdds(makeChoice({ difficulty: 'easy' }), makeChar(), []).riskLabel).toBe('Favorable');
    expect(computeChoiceOdds(makeChoice({ difficulty: 'hard' }), makeChar(), []).riskLabel).toBe('Tough');
  });

  it('flags riddle answers', () => {
    expect(computeChoiceOdds(makeChoice({ riddleAnswer: 'a river' }), makeChar(), []).isRiddleAnswer).toBe(true);
  });
});
