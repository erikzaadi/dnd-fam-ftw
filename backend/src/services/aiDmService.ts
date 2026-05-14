import { AIInput, TurnResult } from '../types.js';
import { createNarrationProvider } from '../providers/ai/AiProviderFactory.js';
import type { NarrationInput } from '../providers/ai/narration/NarrationProvider.js';
import { buildNarrationFallback } from '../providers/ai/narration/narrationFallback.js';
import { resolveEncounterSeed } from './encounterService.js';

export function toNarrationInput(input: AIInput): NarrationInput {
  const actingChar = input.party.find(c => c.id === input.characterId);
  const nextChar = input.party.find(c => c.id === input.activeCharacterId);
  const characterNameById = new Map(input.party.map(c => [c.id, c.name]));
  const selectedChoice = input.lastChoices.find(choice => choice.label === input.actionAttempt);
  const previousChoiceFlavors = input.lastChoices
    .map(choice => choice.flavor ?? 'standard')
    .filter((flavor, index, flavors) => flavors.indexOf(flavor) === index);
  const roll = input.actionResult.roll;
  const statBonus = input.actionResult.statBonus ?? 0;
  const itemBonus = input.actionResult.itemBonus ?? 0;
  const helperBonus = input.actionResult.helperBonus ?? 0;
  const choiceItemBonus = input.actionResult.choiceItemBonus ?? 0;
  const characterBonus = input.actionResult.characterBonus ?? 0;
  const buffBonus = input.actionResult.buffBonus ?? 0;
  const total = typeof roll === 'number' && input.actionResult.statUsed !== 'none'
    ? roll + statBonus + itemBonus + helperBonus + choiceItemBonus + characterBonus + buffBonus
    : undefined;
  const margin = total !== undefined && input.actionResult.difficultyTarget !== undefined
    ? total - input.actionResult.difficultyTarget
    : undefined;

  return {
    scene: input.scene,
    storySummary: input.storySummary || undefined,
    ...(input.scenePressure && { scenePressure: input.scenePressure }),
    ...(input.sceneMomentum && { sceneMomentum: input.sceneMomentum }),
    actingCharacterName: actingChar?.name,
    nextCharacterName: nextChar?.name,
    party: input.party.map(c => ({
      name: c.name,
      class: c.class,
      species: c.species,
      hp: c.hp,
      maxHp: c.max_hp,
      stats: c.stats,
      status: c.status ?? 'active',
      quirk: c.quirk,
      ...(c.gender && { gender: c.gender }),
      ...(c.history && { history: c.history }),
      ...(c.buffs && c.buffs.length > 0 && { buffs: c.buffs }),
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
        tags: item.tags,
        effect: item.effect,
        charges: item.charges,
        condition: item.condition,
        boundToCharacterName: item.boundToCharacterId ? characterNameById.get(item.boundToCharacterId) : undefined,
      }))
    ),
    actionAttempt: input.actionAttempt,
    actionResult: {
      success: input.actionResult.success,
      roll: input.actionResult.roll,
      statUsed: input.actionResult.statUsed === 'none' ? undefined : input.actionResult.statUsed,
      statBonus: input.actionResult.statBonus,
      itemBonus: input.actionResult.itemBonus,
      helperBonus: input.actionResult.helperBonus,
      helperCharacterName: input.actionResult.helperCharacterName,
      choiceItemBonus: input.actionResult.choiceItemBonus,
      choiceItemName: input.actionResult.choiceItemName,
      choiceItemOwnerName: input.actionResult.choiceItemOwnerName,
      characterBonus: input.actionResult.characterBonus,
      characterBonusLabel: input.actionResult.characterBonusLabel,
      buffBonus: input.actionResult.buffBonus,
      buffBonusLabel: input.actionResult.buffBonusLabel,
      total,
      margin,
      difficultyTarget: input.actionResult.difficultyTarget,
      impact: input.actionResult.statUsed === 'none' ? undefined : input.actionResult.impact,
      difficulty: actingChar ? input.difficulty : undefined,
      summary: input.actionResult.success
        ? `The action succeeded${input.actionResult.impact && input.actionResult.impact !== 'normal' ? ` with ${input.actionResult.impact} impact` : ''}.`
        : `The action failed${input.actionResult.impact && input.actionResult.impact !== 'normal' ? ` with ${input.actionResult.impact} impact` : ''}.`,
    },
    recentHistory: input.recentHistory ?? [],
    ...(input.lastChoices.length > 0 && { previousChoiceLabels: input.lastChoices.map(choice => choice.label) }),
    ...(input.lastChoices.some(choice => choice.itemName) && { previousChoiceItemNames: input.lastChoices.map(choice => choice.itemName).filter((name): name is string => !!name) }),
    ...(previousChoiceFlavors.length > 0 && { previousChoiceFlavors }),
    ...(selectedChoice?.flavor && { selectedChoiceFlavor: selectedChoice.flavor }),
    ...(selectedChoice?.environmentFeature && { selectedEnvironmentFeature: selectedChoice.environmentFeature }),
    tone: input.tone,
    gameMode: input.gameMode,
    ...(input.dmPrep && { dmPrep: input.dmPrep }),
    ...(input.dmPrepEncounters && input.dmPrepEncounters.length > 0 && { dmPrepEncounters: input.dmPrepEncounters }),
    isFirstTurn: input.turn === 1,
    interventionRescue: input.interventionRescue,
    sanctuaryRecovery: input.sanctuaryRecovery,
    ...(input.actionIntent && { actionIntent: input.actionIntent }),
    ...(input.encounterState && { encounterState: input.encounterState }),
    encounterJustResolved: input.encounterState != null && input.encounterState.status !== 'active',
    ...(input.pastEncounters && input.pastEncounters.length > 0 && {
      resolvedEncounterEnemyNames: [...new Set(
        input.pastEncounters.slice(-5).flatMap(enc => enc.enemies.map(e => e.name))
      )],
    }),
    ...(input.encounterState != null && input.dmPrepEncounters
      ? (() => {
        const seed = resolveEncounterSeed(input.encounterState!.name, input.dmPrepEncounters!);
        return seed?.lootHint ? { encounterLootHint: seed.lootHint } : {};
      })()
      : {}),
  };
}

export class AiDmService {
  public static async generateTurnResult(input: AIInput): Promise<TurnResult> {
    const narrationInput = toNarrationInput(input);
    try {
      const provider = createNarrationProvider();
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
        suggestedInventoryUpdate: output.suggestedInventoryUpdate ?? null,
        suggestedRevive: output.suggestedRevive ?? null,
        suggestedHeal: output.suggestedHeal ?? null,
        suggestedBuffAdd: output.suggestedBuffAdd ?? null,
        suggestedBuffRemove: output.suggestedBuffRemove ?? null,
        suggestedDamage: output.suggestedDamage ?? null,
        suggestedEncounterStart: output.suggestedEncounterStart ?? null,
        suggestedEncounterUpdate: output.suggestedEncounterUpdate ?? null,
        narrationRetried: output.narrationRetried ?? false,
        narrationFailed: output.narrationFailed ?? false,
        narrationValidationError: output.narrationValidationError,
        narrationRetryValidationError: output.narrationRetryValidationError,
        imageUrl: null,
      };
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      if (status === 429) {
        throw error;
      }
      console.error('Error calling AI service:', error);
      return {
        ...buildNarrationFallback(narrationInput),
        narrationFailed: true,
        narrationValidationError: error instanceof Error ? error.message : String(error),
        imageUrl: null,
      };
    }
  }
}
