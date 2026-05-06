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
  it('rejects portal choices when this turn did not complete combat or a difficult challenge', () => {
    const result = parseNarrationOutput(input, output({
      narration: 'A portal opens with a low violet hum.',
      choices: [
        { label: 'Enter the portal', difficulty: 'easy', stat: 'magic', difficultyValue: 1 },
        { label: 'Check the threshold', difficulty: 'easy', stat: 'mischief', difficultyValue: 6 },
        { label: 'Brace and charge through', difficulty: 'normal', stat: 'might', difficultyValue: 10 },
      ],
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('complete combat or a difficult challenge');
    }
  });

  it('accepts portal choices after a successful difficult challenge', () => {
    const result = parseNarrationOutput({
      ...input,
      actionAttempt: 'Disarm the collapsing bridge trap',
      actionResult: {
        success: true,
        summary: 'Pip disarmed the bridge trap before it could collapse.',
        difficultyTarget: 14,
        impact: 'strong',
      },
    }, output({
      narration: 'A cloaked figure gestures sharply and opens a portal beside the fallen foe.',
      choices: [
        { label: 'Enter the portal', difficulty: 'easy', stat: 'magic', difficultyValue: 1 },
        { label: 'Question the figure', difficulty: 'normal', stat: 'mischief', difficultyValue: 10 },
        { label: 'Guard the party', difficulty: 'normal', stat: 'might', difficultyValue: 11 },
      ],
    }));

    expect(result.success).toBe(true);
  });

  it('accepts portal choices after completed combat', () => {
    const result = parseNarrationOutput({
      ...input,
      actionAttempt: 'Defeat the spectral wolves',
      actionResult: {
        success: true,
        summary: 'The spectral wolves fall back and the combat ends in victory.',
      },
    }, output({
      narration: 'A cloaked figure appears, gesturing towards an ethereal portal shimmering with light.',
      choices: [
        { label: 'Follow the portal to the unknown', difficulty: 'easy', stat: 'magic', difficultyValue: 1 },
        { label: 'Question the figure', difficulty: 'normal', stat: 'mischief', difficultyValue: 10 },
        { label: 'Guard the party', difficulty: 'normal', stat: 'might', difficultyValue: 11 },
      ],
    }));

    expect(result.success).toBe(true);
  });

  it('accepts portal choices when a sprite urges the party toward the portal after combat', () => {
    const result = parseNarrationOutput({
      ...input,
      actionAttempt: 'Strike the shadow monster',
      actionResult: {
        success: true,
        summary: 'Pip lands the final blow and the monster is defeated.',
      },
    }, output({
      narration: 'A shimmering portal opens behind the foe, and Fiddlewick the sprite chirps excitedly, urging the party to seize the opportunity.',
      choices: [
        { label: 'Dive through the shimmering portal', difficulty: 'easy', stat: 'mischief', difficultyValue: 1, flavor: 'environment', environmentFeature: 'shimmering portal' },
        { label: 'Question Fiddlewick first', difficulty: 'normal', stat: 'mischief', difficultyValue: 10 },
        { label: 'Guard the party', difficulty: 'normal', stat: 'might', difficultyValue: 11 },
      ],
    }));

    expect(result.success).toBe(true);
  });

  it('rejects portal choices when structured scene pressure says they are not earned yet', () => {
    const result = parseNarrationOutput({
      ...input,
      actionAttempt: 'Strike the shadow monster',
      actionResult: {
        success: true,
        summary: 'Pip lands a normal hit.',
        difficultyTarget: 12,
        impact: 'normal',
      },
      scenePressure: {
        kind: 'combat',
        pressureTurns: 1,
        successfulPressureTurns: 1,
        previousTensionLevels: ['high'],
        portalEligibleThisTurn: false,
        reason: 'Portal transition not earned by current turn pressure.',
      },
    }, output({
      narration: 'The monster staggers, and a portal flares behind it.',
      choices: [
        { label: 'Dive through the shimmering portal', difficulty: 'easy', stat: 'mischief', difficultyValue: 1 },
        { label: 'Press the attack', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
        { label: 'Guard the party', difficulty: 'normal', stat: 'might', difficultyValue: 11 },
      ],
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('complete combat or a difficult challenge');
    }
  });

  it('accepts portal choices when structured scene pressure says this turn earned one', () => {
    const result = parseNarrationOutput({
      ...input,
      actionAttempt: 'Strike the shadow monster',
      actionResult: {
        success: true,
        summary: 'Pip lands a decisive final blow.',
        difficultyTarget: 14,
        impact: 'strong',
      },
      scenePressure: {
        kind: 'combat',
        pressureTurns: 2,
        successfulPressureTurns: 2,
        previousTensionLevels: ['medium', 'high'],
        portalEligibleThisTurn: true,
        reason: 'Current turn earned a fast transition after sustained pressure.',
      },
    }, output({
      narration: 'The monster collapses, and a summoned spirit opens a bright shortcut.',
      choices: [
        { label: 'Take the shortcut', difficulty: 'easy', stat: 'mischief', difficultyValue: 1 },
        { label: 'Question the spirit', difficulty: 'normal', stat: 'mischief', difficultyValue: 10 },
        { label: 'Guard the party', difficulty: 'normal', stat: 'might', difficultyValue: 11 },
      ],
    }));

    expect(result.success).toBe(true);
  });

  it('rejects portal choices after healing even when the existing story already established a portal', () => {
    const result = parseNarrationOutput({
      ...input,
      actionAttempt: 'Heal the whole party',
      storySummary: 'A shimmering portal waits at the edge of the bridge.',
      actionResult: {
        success: true,
        summary: 'Pip restores the party with a careful healing spell.',
        difficultyTarget: 14,
        impact: 'strong',
      },
    }, output({
      narration: 'Pip takes a moment to steady the party.',
      choices: [
        { label: 'Step through the portal', difficulty: 'easy', stat: 'magic', difficultyValue: 8 },
        { label: 'Check the threshold', difficulty: 'normal', stat: 'mischief', difficultyValue: 10 },
        { label: 'Guard the party', difficulty: 'normal', stat: 'might', difficultyValue: 11 },
      ],
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('complete combat or a difficult challenge');
    }
  });

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
        portalEligibleThisTurn: false,
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

  it('rejects healing state changes when the action was not healing or recovery', () => {
    const result = parseNarrationOutput({ ...input, actionAttempt: 'Teleport the party through the portal' }, output({
      narration: 'Pip guides the party through a bright portal to a safer path.',
      suggestedHeal: [{ characterName: 'Pip', hp: 2 }],
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('suggestedHeal');
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
