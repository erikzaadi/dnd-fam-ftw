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

  it('rejects more than two bonus-bearing choices in one turn', () => {
    const result = parseNarrationOutput(input, output({
      choices: [
        { label: 'Use Pip\'s rogue nerve', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, flavor: 'spotlight' },
        { label: 'Talk down the keep spirit', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, flavor: 'social' },
        { label: 'Lean into Pip\'s halfling luck', difficulty: 'easy', stat: 'mischief', difficultyValue: 8, flavor: 'spotlight' },
      ],
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('No more than two bonus-bearing choices');
    }
  });
});
