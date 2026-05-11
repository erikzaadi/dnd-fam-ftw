import type { NarrationInput, NarrationOutput, NarrationProvider } from './NarrationProvider.js';

const choices = [
  { label: 'Press the attack', difficulty: 'normal' as const, stat: 'might' as const, difficultyValue: 12, narration: 'Keep the pressure on with a bold move.' },
  { label: 'Taunt the goblin', difficulty: 'easy' as const, stat: 'mischief' as const, difficultyValue: 8, narration: 'Distract the foe with theatrical confidence.' },
  { label: 'Flee dramatically', difficulty: 'hard' as const, stat: 'magic' as const, difficultyValue: 16, narration: 'Turn retreat into a dazzling arcane escape.' },
];

export class MockNarrationProvider implements NarrationProvider {
  async generateTurn(input: NarrationInput): Promise<NarrationOutput> {
    const actor = input.actingCharacterName ?? 'The adventurer';
    const grantsBridgeToken = input.actionAttempt === 'Time the jump while Zara steadies the spell';
    return {
      narration: `${actor} acts decisively: ${input.actionAttempt}. The mock DM confirms the adventure moves forward.`,
      rollNarration: input.actionResult.roll
        ? `The die lands on ${input.actionResult.roll}.`
        : 'No roll was needed.',
      choices,
      imagePrompt: null,
      imageSuggested: false,
      currentTensionLevel: 'medium',
      suggestedInventoryAdd: grantsBridgeToken
        ? {
          name: 'Silver Bridge Token',
          description: 'A small token awarded by the clockwork bridge keeper.',
          statBonuses: {},
          transferable: true,
          consumable: false,
        }
        : null,
      suggestedInventoryRemove: null,
      suggestedInventoryUpdate: null,
      suggestedRevive: null,
      suggestedHeal: null,
      suggestedBuffAdd: null,
      suggestedBuffRemove: null,
      suggestedDamage: null,
    };
  }
}
