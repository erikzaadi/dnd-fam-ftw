import { AIInput, TurnResult } from '../types.js';
import { createNarrationProvider } from '../ai/AiProviderFactory.js';
import type { NarrationInput } from '../ai/narration/NarrationProvider.js';
import { NARRATION_FALLBACK } from '../ai/narration/narrationSchemas.js';

export function toNarrationInput(input: AIInput): NarrationInput {
  const activeChar = input.party.find(c => c.id === input.activeCharacterId);

  return {
    scene: input.scene,
    storySummary: input.storySummary || undefined,
    party: input.party.map(c => ({
      name: c.name,
      class: c.class,
      hp: c.hp,
      maxHp: c.max_hp,
      status: c.status ?? 'active',
      quirk: c.quirk,
    })),
    inventory: input.party.flatMap(c =>
      (c.inventory ?? []).map(item => ({
        ownerName: c.name,
        name: item.name,
        description: item.description,
        statBonuses: item.statBonuses ?? {},
        healValue: item.healValue,
        consumable: item.consumable,
        transferable: item.transferable,
      }))
    ),
    actionAttempt: input.actionAttempt,
    actionResult: {
      success: input.actionResult.success,
      roll: input.actionResult.roll,
      statUsed: input.actionResult.statUsed === 'none' ? undefined : input.actionResult.statUsed,
      difficulty: activeChar ? input.difficulty : undefined,
      summary: input.actionResult.success ? 'The action succeeded.' : 'The action failed.',
    },
    recentHistory: input.recentHistory ?? [],
    tone: input.tone,
    isFirstTurn: input.turn === 1,
    interventionRescue: input.interventionRescue,
    sanctuaryRecovery: input.sanctuaryRecovery,
  };
}

export class AiDmService {
  public static async generateTurnResult(input: AIInput, useLocalAI?: boolean): Promise<TurnResult> {
    try {
      const provider = createNarrationProvider(useLocalAI);
      const narrationInput = toNarrationInput(input);
      const output = await provider.generateTurn(narrationInput);

      return {
        narration: output.narration,
        choices: output.choices,
        imagePrompt: output.imagePrompt,
        imageSuggested: output.imageSuggested,
        suggestedInventoryAdd: output.suggestedInventoryAdd ?? null,
        imageUrl: null,
      };
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      if (status === 429) {
        throw error;
      }
      console.error('Error calling AI service:', error);
      return {
        ...NARRATION_FALLBACK,
        imageUrl: null,
      };
    }
  }
}
