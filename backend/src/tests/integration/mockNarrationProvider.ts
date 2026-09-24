import { vi } from 'vitest';
import type { NarrationInput, NarrationOutput, NarrationProvider } from '../../providers/ai/narration/NarrationProvider.js';

export const FIXED_NARRATION_OUTPUT: NarrationOutput = {
  narration: 'The goblin stumbles back, surprised.',
  choices: [
    { label: 'Press the attack', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
    { label: 'Taunt the goblin', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
    { label: 'Flee dramatically', difficulty: 'hard', stat: 'magic', difficultyValue: 16 },
  ],
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

// Staged provider for the resolved_first strategy: scripted mechanics, then
// presentation. Lets tests assert what narration saw without any AI spend.
export const mockProposeMechanics = vi.fn<NonNullable<NarrationProvider['proposeMechanics']>>();
export const mockNarrateResolved = vi.fn<NonNullable<NarrationProvider['narrateResolved']>>();

export const resetStagedMockNarrationProvider = (): void => {
  mockProposeMechanics.mockReset();
  mockNarrateResolved.mockReset();
  mockProposeMechanics.mockResolvedValue({
    suggestedDamage: null,
    suggestedEncounterStart: null,
    suggestedEncounterUpdate: null,
    suggestedInventoryAdd: null,
    suggestedInventoryRemove: null,
    suggestedInventoryUpdate: null,
    suggestedRevive: null,
    suggestedHeal: null,
    suggestedBuffAdd: null,
    suggestedBuffRemove: null,
  });
  mockNarrateResolved.mockResolvedValue({
    narration: FIXED_NARRATION_OUTPUT.narration,
    currentTensionLevel: 'medium',
    choices: FIXED_NARRATION_OUTPUT.choices,
    objectiveOutcome: null,
  });
};

export const createStagedMockNarrationProvider = (): NarrationProvider => ({
  generateTurn: mockGenerateTurn,
  proposeMechanics: mockProposeMechanics,
  narrateResolved: mockNarrateResolved,
});
