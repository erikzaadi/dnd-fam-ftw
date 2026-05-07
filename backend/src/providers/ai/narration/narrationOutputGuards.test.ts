import { describe, expect, it } from 'vitest';
import type { NarrationInput, NarrationOutput } from './NarrationProvider.js';
import { parseNarrationOutput } from './narrationOutputGuards.js';

const input: NarrationInput = {
  scene: 'A ruined keep',
  party: [
    { name: 'Pip', class: 'Rogue', species: 'Halfling', hp: 8, maxHp: 8, status: 'active' },
  ],
  inventory: [],
  actionAttempt: 'Search the hall',
  actionResult: { success: true, summary: 'The action succeeded.' },
  recentHistory: [],
  tone: 'playful',
  gameMode: 'fast',
};

const output = (overrides: Partial<NarrationOutput> = {}): NarrationOutput => ({
  narration: 'Pip finds a cracked staircase leading deeper into the keep.',
  choices: [
    { label: 'Follow the stairs', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
    { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
    { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
  ],
  rollNarration: 'No roll was needed.',
  imagePrompt: null,
  imageSuggested: false,
  currentTensionLevel: 'medium',
  suggestedInventoryAdd: null,
  suggestedInventoryRemove: null,
  suggestedInventoryUpdate: null,
  suggestedRevive: null,
  suggestedHeal: null,
  suggestedDamage: null,
  ...overrides,
});

describe('parseNarrationOutput', () => {
  it('normalizes zug-ma-geddon output to high tension', () => {
    const result = parseNarrationOutput({ ...input, gameMode: 'zug-ma-geddon' }, output({
      currentTensionLevel: 'medium',
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currentTensionLevel).toBe('high');
    }
  });

  it('normalizes combat scene pressure to high tension', () => {
    const result = parseNarrationOutput({
      ...input,
      scenePressure: {
        kind: 'combat',
        pressureTurns: 1,
        successfulPressureTurns: 0,
        previousTensionLevels: ['medium'],
        reason: 'Combat pressure should drive high tension.',
      },
    }, output({
      currentTensionLevel: 'medium',
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currentTensionLevel).toBe('high');
    }
  });

  it('downgrades environment choices without an environment feature', () => {
    const result = parseNarrationOutput(input, output({
      choices: [
        { label: 'Leap across the crumbling stair', difficulty: 'normal', stat: 'might', difficultyValue: 11, flavor: 'environment' },
        { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.choices[0].flavor).toBe('standard');
    }
  });

  it('allows more than two bonus-bearing choices without discarding a successful party heal', () => {
    const result = parseNarrationOutput({ ...input, actionAttempt: 'Heal the party' }, output({
      narration: 'Pip chants a bright healing rhyme, and the whole party steadies themselves.',
      choices: [
        { label: 'Use Pip\'s rogue nerve', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, flavor: 'spotlight' },
        { label: 'Talk down the keep spirit', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, flavor: 'social' },
        { label: 'Lean into Pip\'s halfling luck', difficulty: 'easy', stat: 'mischief', difficultyValue: 8, flavor: 'spotlight' },
      ],
      suggestedHeal: [{ characterName: 'Pip', hp: 3 }],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggestedHeal).toEqual([{ characterName: 'Pip', hp: 3 }]);
    }
  });

  it('strips suggestedHeal when the action was not healing or recovery', () => {
    const result = parseNarrationOutput({ ...input, actionAttempt: 'Strike the enemy' }, output({
      narration: 'Pip lands a solid blow.',
      suggestedHeal: [{ characterName: 'Pip', hp: 2 }],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggestedHeal).toBeNull();
    }
  });

  it('downgrades combo choices with an invalid helper to standard', () => {
    const result = parseNarrationOutput(input, output({
      choices: [
        { label: 'Team up with Zara', difficulty: 'easy', stat: 'magic', difficultyValue: 8, flavor: 'combo', helperCharacterName: 'Zara' },
        { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.choices[0].flavor).toBe('standard');
      expect(result.data.choices[0].helperCharacterName).toBeUndefined();
    }
  });

  it('canonicalizes item choice names when the model omits the leading emoji', () => {
    const result = parseNarrationOutput({
      ...input,
      inventory: [
        { ownerName: 'Pip', name: '🧭 Brass Compass', description: 'Points to safe paths', statBonuses: {} },
      ],
    }, output({
      choices: [
        { label: 'Follow the Brass Compass', difficulty: 'easy', stat: 'mischief', difficultyValue: 8, flavor: 'item', itemOwnerName: 'Pip', itemName: 'Brass Compass' },
        { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.choices[0].itemName).toBe('🧭 Brass Compass');
    }
  });

  it('downgrades invalid item choices instead of discarding the resolved turn', () => {
    const result = parseNarrationOutput(input, output({
      choices: [
        { label: 'Ring your bell to call for aid', difficulty: 'hard', stat: 'might', difficultyValue: 15, flavor: 'item', itemOwnerName: 'Oswin Bell', itemName: 'Bell of Summoning' },
        { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.choices[0].flavor).toBe('standard');
      expect(result.data.choices[0].itemOwnerName).toBeUndefined();
      expect(result.data.choices[0].itemName).toBeUndefined();
    }
  });
});
