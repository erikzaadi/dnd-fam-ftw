import { describe, expect, it } from 'vitest';
import { buildNarrationFallback } from './narrationFallback.js';
import type { NarrationInput } from './NarrationProvider.js';

const makeInput = (overrides: Partial<NarrationInput> = {}): NarrationInput => ({
  scene: 'A new realm',
  party: [{ name: 'Pip', class: 'Rogue', species: 'Halfling', hp: 8, maxHp: 10, stats: { might: 1, magic: 2, mischief: 4 }, status: 'active' }],
  inventory: [],
  actingCharacterName: 'Pip',
  actionAttempt: 'Sneak past the guard',
  actionResult: { success: true, summary: 'ok' },
  recentHistory: [],
  tone: 'comedic',
  ...overrides,
});

describe('buildNarrationFallback', () => {
  it('uses a real opener on the first turn instead of the action template', () => {
    const result = buildNarrationFallback(makeInput({
      isFirstTurn: true,
      actionAttempt: 'Adventure begins!',
    }));

    expect(result.narration).toMatch(/^The adventure begins\./);
    expect(result.narration).not.toContain('works.');
    expect(result.choices).toHaveLength(3);
  });

  it('starts the beat sentence with a capital letter', () => {
    const result = buildNarrationFallback(makeInput());

    expect(result.narration).toContain('The area is not the same as it was a moment ago.');
  });

  it('keeps the action template for success on later turns', () => {
    const result = buildNarrationFallback(makeInput());

    expect(result.narration).toContain("Pip's Sneak past the guard works.");
  });

  it('keeps the action template for failure on later turns', () => {
    const result = buildNarrationFallback(makeInput({ actionResult: { success: false, summary: 'missed' } }));

    expect(result.narration).toContain('falls short.');
  });
});
