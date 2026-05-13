import { vi } from 'vitest';
import type { NarrationInput, NarrationOutput, NarrationProvider } from '../../providers/ai/narration/NarrationProvider.js';

export const FIXED_NARRATION_OUTPUT: NarrationOutput = {
  narration: 'The goblin stumbles back, surprised.',
  choices: [
    { label: 'Press the attack', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
    { label: 'Taunt the goblin', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
    { label: 'Flee dramatically', difficulty: 'hard', stat: 'magic', difficultyValue: 16 },
  ],
  imagePrompt: null,
  imageSuggested: false,
  currentTensionLevel: 'medium',
  suggestedInventoryAdd: null,
  suggestedInventoryRemove: null,
  suggestedInventoryUpdate: null,
  suggestedRevive: null,
  suggestedHeal: null,
  suggestedBuffAdd: null,
  suggestedBuffRemove: null,
  suggestedDamage: null,
  suggestedEncounterStart: null,
  suggestedEncounterUpdate: null,
};

export const mockGenerateTurn = vi.fn<(input: NarrationInput) => Promise<NarrationOutput>>();

export const resetMockNarrationProvider = (output: NarrationOutput = FIXED_NARRATION_OUTPUT): void => {
  mockGenerateTurn.mockReset();
  mockGenerateTurn.mockResolvedValue(output);
};

export const createMockNarrationProvider = (): NarrationProvider => ({
  generateTurn: mockGenerateTurn,
});
