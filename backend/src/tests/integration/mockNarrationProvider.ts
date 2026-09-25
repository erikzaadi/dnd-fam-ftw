import { afterEach, beforeEach, expect, vi } from 'vitest';
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

// Both turn strategies, for suites that must hold whichever one runs. resolved_first is
// the default; parallel is the opt-out.
export const TURN_STRATEGIES = ['parallel', 'resolved_first'] as const;
export type TestTurnStrategy = typeof TURN_STRATEGIES[number];

// Scripts one turn for both strategies: the parallel monolith returns the output whole,
// resolved_first gets its mechanics from proposeMechanics and its prose from
// narrateResolved. Use with createStagedMockNarrationProvider.
export const scriptTurnOutput = (output: NarrationOutput = FIXED_NARRATION_OUTPUT): void => {
  resetMockNarrationProvider(output);
  resetStagedMockNarrationProvider();
  mockProposeMechanics.mockResolvedValue({
    suggestedDamage: output.suggestedDamage ?? null,
    suggestedEncounterStart: output.suggestedEncounterStart ?? null,
    suggestedEncounterUpdate: output.suggestedEncounterUpdate ?? null,
    suggestedInventoryAdd: output.suggestedInventoryAdd ?? null,
    suggestedInventoryRemove: output.suggestedInventoryRemove ?? null,
    suggestedInventoryUpdate: output.suggestedInventoryUpdate ?? null,
    suggestedRevive: output.suggestedRevive ?? null,
    suggestedHeal: output.suggestedHeal ?? null,
    suggestedBuffAdd: output.suggestedBuffAdd ?? null,
    suggestedBuffRemove: output.suggestedBuffRemove ?? null,
  });
  const extra = output as NarrationOutput & { choicesFailed?: boolean; choicesEscalated?: boolean };
  mockNarrateResolved.mockResolvedValue({
    narration: output.narration,
    rollNarration: output.rollNarration,
    currentTensionLevel: output.currentTensionLevel,
    choices: output.choices,
    objectiveOutcome: output.objectiveOutcome ?? null,
    narratedRiddle: output.narratedRiddle,
    narrationFailed: output.narrationFailed,
    choicesFailed: extra.choicesFailed,
    choicesEscalated: extra.choicesEscalated,
  });
};

// The mock that narrated the turn under a strategy, and the input it saw.
export const narratingMock = (strategy: TestTurnStrategy) => (strategy === 'parallel' ? mockGenerateTurn : mockNarrateResolved);
export const narrationInputFor = (strategy: TestTurnStrategy, call = 0): NarrationInput | undefined => narratingMock(strategy).mock.calls[call]?.[0];

// Fails when a turn quietly ran a different strategy (e.g. resolved_first falling back
// to parallel because the provider mock has no staged methods).
export const expectTurnStrategy = (result: { ok: boolean; diagnostics?: { strategy: string } }, strategy: TestTurnStrategy): void => {
  expect(result.ok && result.diagnostics?.strategy).toBe(strategy);
};

// For suites whose assertions are specific to one pipeline (e.g. parallel-only repairs
// of narration that disagrees with mechanics). Makes the choice explicit instead of
// relying on a silent fallback.
export const pinTurnStrategy = (strategy: TestTurnStrategy): void => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.AI_TURN_STRATEGY;
    process.env.AI_TURN_STRATEGY = strategy;
  });
  afterEach(() => {
    if (previous === undefined) {
      delete process.env.AI_TURN_STRATEGY;
    } else {
      process.env.AI_TURN_STRATEGY = previous;
    }
  });
};
