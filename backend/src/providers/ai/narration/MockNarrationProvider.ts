import type { MechanicsProposal, NarrationInput, NarrationOutput, NarrationProvider, ResolvedPresentation } from './NarrationProvider.js';

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
      // Like the real orchestrator: no pre-made choices, ideas come from generateIdeas.
      choices: [],
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
      suggestedEncounterStart: null,
      suggestedEncounterUpdate: null,
      // Deterministic finale for E2E: a successful decisive attempt resolves the chapter.
      objectiveOutcome: input.adventureDirective?.decisiveMoment
        ? (input.actionResult.success ? 'resolved_success' : 'advanced')
        : null,
    };
  }

  async generateIdeas(): Promise<{ choices: typeof choices; degraded: boolean }> {
    return { choices: choices.map(choice => ({ ...choice })), degraded: false };
  }

  // resolved_first stages, deterministic for E2E runs with AI_TURN_STRATEGY=resolved_first.
  async proposeMechanics(input: NarrationInput): Promise<MechanicsProposal> {
    const full = await this.generateTurn(input);
    return {
      suggestedDamage: full.suggestedDamage,
      suggestedEncounterStart: full.suggestedEncounterStart,
      suggestedEncounterUpdate: full.suggestedEncounterUpdate,
      suggestedInventoryAdd: full.suggestedInventoryAdd,
      suggestedInventoryRemove: full.suggestedInventoryRemove,
      suggestedInventoryUpdate: full.suggestedInventoryUpdate,
      suggestedRevive: full.suggestedRevive,
      suggestedHeal: full.suggestedHeal,
      suggestedBuffAdd: full.suggestedBuffAdd,
      suggestedBuffRemove: full.suggestedBuffRemove,
    };
  }

  async narrateResolved(input: NarrationInput): Promise<ResolvedPresentation> {
    const full = await this.generateTurn(input);
    const factLine = input.resolvedTurn?.facts[0] ?? '';
    return {
      narration: `${full.narration} ${factLine}`.trim(),
      rollNarration: full.rollNarration,
      currentTensionLevel: full.currentTensionLevel,
      choices: full.choices,
      objectiveOutcome: full.objectiveOutcome,
    };
  }
}
