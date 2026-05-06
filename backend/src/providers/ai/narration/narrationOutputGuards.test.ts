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
  it('rejects portal choices when this turn narration lacks an NPC offer or activation', () => {
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
      expect(result.error).toContain('NPC');
    }
  });

  it('accepts portal choices when this turn narration has an NPC activating the portal', () => {
    const result = parseNarrationOutput(input, output({
      narration: 'A cloaked figure gestures sharply and opens a portal beside the fallen foe.',
      choices: [
        { label: 'Enter the portal', difficulty: 'easy', stat: 'magic', difficultyValue: 1 },
        { label: 'Question the figure', difficulty: 'normal', stat: 'mischief', difficultyValue: 10 },
        { label: 'Guard the party', difficulty: 'normal', stat: 'might', difficultyValue: 11 },
      ],
    }));

    expect(result.success).toBe(true);
  });

  it('accepts portal choices when an NPC is gesturing towards the portal', () => {
    const result = parseNarrationOutput(input, output({
      narration: 'A cloaked figure appears, gesturing towards an ethereal portal shimmering with light.',
      choices: [
        { label: 'Follow the portal to the unknown', difficulty: 'easy', stat: 'magic', difficultyValue: 1 },
        { label: 'Question the figure', difficulty: 'normal', stat: 'mischief', difficultyValue: 10 },
        { label: 'Guard the party', difficulty: 'normal', stat: 'might', difficultyValue: 11 },
      ],
    }));

    expect(result.success).toBe(true);
  });

  it('accepts portal choices when a sprite urges the party toward the portal opportunity', () => {
    const result = parseNarrationOutput(input, output({
      narration: 'A shimmering portal opens behind the foe, and Fiddlewick the sprite chirps excitedly, urging the party to seize the opportunity.',
      choices: [
        { label: 'Dive through the shimmering portal', difficulty: 'easy', stat: 'mischief', difficultyValue: 1, flavor: 'environment', environmentFeature: 'shimmering portal' },
        { label: 'Question Fiddlewick first', difficulty: 'normal', stat: 'mischief', difficultyValue: 10 },
        { label: 'Guard the party', difficulty: 'normal', stat: 'might', difficultyValue: 11 },
      ],
    }));

    expect(result.success).toBe(true);
  });

  it('rejects zug-ma-geddon output below high tension', () => {
    const result = parseNarrationOutput({ ...input, gameMode: 'zug-ma-geddon' }, output({
      currentTensionLevel: 'medium',
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('zug-ma-geddon');
    }
  });

  it('rejects environment choices without an environment feature', () => {
    const result = parseNarrationOutput(input, output({
      choices: [
        { label: 'Leap across the crumbling stair', difficulty: 'normal', stat: 'might', difficultyValue: 11, flavor: 'environment' },
        { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('environmentFeature');
    }
  });

  it('allows more than two bonus-bearing choices without discarding a successful party heal', () => {
    const result = parseNarrationOutput(input, output({
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
});
