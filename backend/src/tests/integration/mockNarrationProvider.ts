import { vi } from 'vitest';
import type { NarrationInput, NarrationOutput, NarrationProvider } from '../../providers/ai/narration/NarrationProvider.js';

export const FIXED_NARRATION_OUTPUT: NarrationOutput = {
  narration: 'The goblin stumbles back, surprised.',
  choices: [
    { label: 'Press the attack', difficulty: 'normal', stat: 'might' },
    { label: 'Taunt the goblin', difficulty: 'easy', stat: 'mischief' },
    { label: 'Flee dramatically', difficulty: 'hard', stat: 'magic' },
  ],
  imagePrompt: null,
  imageSuggested: false,
  currentTensionLevel: 'medium',
  suggestedInventoryAdd: null,
  suggestedInventoryRemove: null,
  suggestedRevive: null,
  suggestedHeal: null,
  suggestedDamage: null,
};

export const mockGenerateTurn = vi.fn<(input: NarrationInput) => Promise<NarrationOutput>>();

export const resetMockNarrationProvider = (output: NarrationOutput = FIXED_NARRATION_OUTPUT): void => {
  mockGenerateTurn.mockReset();
  mockGenerateTurn.mockResolvedValue(output);
};

export const createMockNarrationProvider = (): NarrationProvider => ({
  generateTurn: mockGenerateTurn,
});
