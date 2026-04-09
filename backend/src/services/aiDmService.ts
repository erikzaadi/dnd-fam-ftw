import { AIInput, TurnResult } from '../types.js';
import { createNarrationProvider } from '../ai/AiProviderFactory.js';
import type { NarrationInput } from '../ai/narration/NarrationProvider.js';
import { NARRATION_FALLBACK } from '../ai/narration/narrationSchemas.js';

function toNarrationInput(input: AIInput): NarrationInput {
  const activeChar = input.party.find(c => c.id === input.activeCharacterId);
  const allInventory = input.party.flatMap(c => c.inventory ?? []);

  return {
    scene: input.scene,
    party: input.party.map(c => ({
      name: c.name,
      class: c.class,
      hp: c.hp,
      maxHp: c.max_hp,
      quirk: c.quirk,
    })),
    inventory: allInventory.map(item => ({
      name: item.name,
      description: item.description,
      statBonuses: item.statBonuses ?? {},
    })),
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
