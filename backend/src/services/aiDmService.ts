import { AIInput, TurnResult } from '../types.js';
import { createNarrationProvider } from '../providers/ai/AiProviderFactory.js';
import type { NarrationInput } from '../providers/ai/narration/NarrationProvider.js';
import { NARRATION_FALLBACK } from '../providers/ai/narration/narrationSchemas.js';

export function toNarrationInput(input: AIInput): NarrationInput {
  const actingChar = input.party.find(c => c.id === input.characterId);
  const nextChar = input.party.find(c => c.id === input.activeCharacterId);

  return {
    scene: input.scene,
    storySummary: input.storySummary || undefined,
    actingCharacterName: actingChar?.name,
    nextCharacterName: nextChar?.name,
    party: input.party.map(c => ({
      name: c.name,
      class: c.class,
      hp: c.hp,
      maxHp: c.max_hp,
      status: c.status ?? 'active',
      quirk: c.quirk,
      ...(c.gender && { gender: c.gender }),
      ...(c.history && { history: c.history }),
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
      difficulty: actingChar ? input.difficulty : undefined,
      summary: input.actionResult.success ? 'The action succeeded.' : 'The action failed.',
    },
    recentHistory: input.recentHistory ?? [],
    tone: input.tone,
    gameMode: input.gameMode,
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
        rollNarration: output.rollNarration,
        imagePrompt: output.imagePrompt,
        imageSuggested: output.imageSuggested,
        currentTensionLevel: output.currentTensionLevel,
        suggestedInventoryAdd: output.suggestedInventoryAdd ?? null,
        suggestedInventoryRemove: output.suggestedInventoryRemove ?? null,
        suggestedRevive: output.suggestedRevive ?? null,
        suggestedHeal: output.suggestedHeal ?? null,
        suggestedDamage: output.suggestedDamage ?? null,
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
