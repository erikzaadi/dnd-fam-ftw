import { AIInput, TurnResult } from '../types.js';
import { createNarrationProvider } from '../providers/ai/AiProviderFactory.js';
import type { NarrationInput, NarrationOutput, NarrationStreamCallbacks } from '../providers/ai/narration/NarrationProvider.js';
import { buildNarrationFallback } from '../providers/ai/narration/narrationFallback.js';
import { resolveEncounterSeed } from './encounterService.js';
import { devLog } from '../lib/devLog.js';
import { getConfig } from '../config/env.js';
import { DmTurnOrchestrator, type DmTurnOrchestratorResult } from './dmTurnOrchestrator.js';
import {
  getSessionPromptCache,
  setSessionPromptCache,
  type CachedStablePartyMember,
  type CachedInventoryItem,
} from '../lib/sessionPromptCache.js';

function computePartyVersion(party: AIInput['party']): string {
  return party
    .map(c =>
      [
        c.id,
        c.name,
        c.class,
        c.species,
        JSON.stringify(c.stats),
        c.max_hp,
        c.quirk,
        (c.history ?? '').slice(0, 200),
        c.gender ?? '',
      ].join('|'),
    )
    .join(';');
}

function computeInventoryVersion(party: AIInput['party'], characterNameById: Map<string, string>): string {
  return party
    .flatMap(c =>
      (c.inventory ?? []).map(item =>
        [
          c.name,
          item.name,
          item.description.slice(0, 200),
          JSON.stringify(item.statBonuses ?? {}),
          characterNameById.get(item.boundToCharacterId ?? '') ?? '',
          item.charges ?? '',
          item.condition ?? '',
        ].join('|'),
      ),
    )
    .join(';');
}

function buildStableParty(party: AIInput['party']): CachedStablePartyMember[] {
  return party.map(c => ({
    name: c.name,
    class: c.class,
    species: c.species,
    maxHp: c.max_hp,
    stats: c.stats,
    quirk: c.quirk,
    ...(c.gender && { gender: c.gender }),
    ...(c.history && { history: c.history.length > 200 ? c.history.slice(0, 200) : c.history }),
  }));
}

function buildInventorySnippet(party: AIInput['party'], characterNameById: Map<string, string>): CachedInventoryItem[] {
  return party.flatMap(c =>
    (c.inventory ?? []).map(item => ({
      ownerName: c.name,
      name: item.name,
      description: item.description.length > 200 ? item.description.slice(0, 200) : item.description,
      statBonuses: item.statBonuses ?? {},
      healValue: item.healValue,
      consumable: item.consumable,
      transferable: item.transferable,
      tags: item.tags,
      effect: item.effect && item.effect.length <= 150 ? item.effect : undefined,
      charges: item.charges,
      condition: item.condition,
      boundToCharacterName: item.boundToCharacterId ? characterNameById.get(item.boundToCharacterId) : undefined,
    })),
  );
}

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

  const isActiveEncounter = input.encounterState?.status === 'active';

  // Build compacted dmPrep - omitted during active encounters, compiled premise preferred otherwise
  let compactedDmPrep: string | undefined;
  if (input.dmPrep && !isActiveEncounter) {
    if (input.compiledDmPrep) {
      compactedDmPrep = input.compiledDmPrep;
    } else {
      compactedDmPrep = input.dmPrep.length > 3000
        ? input.dmPrep.slice(0, 3000)
        : input.dmPrep;
    }
  }
  const dmPrepSource = !input.dmPrep || isActiveEncounter ? 'omitted' : input.compiledDmPrep ? 'compiled' : 'raw';
  devLog.log(`[AiDm] dmPrep-source=${dmPrepSource} chars=${compactedDmPrep?.length ?? 0}`);

  // Stable party/inventory snippets are cached per session and rebuilt only when stable sources change.
  const partyVersion = computePartyVersion(input.party);
  const inventoryVersion = computeInventoryVersion(input.party, characterNameById);
  const cached = getSessionPromptCache(input.id, partyVersion, inventoryVersion);

  let stableParty: CachedStablePartyMember[];
  let inventorySnippet: CachedInventoryItem[];
  if (cached) {
    stableParty = cached.stableParty;
    inventorySnippet = cached.inventory;
  } else {
    stableParty = buildStableParty(input.party);
    inventorySnippet = buildInventorySnippet(input.party, characterNameById);
    setSessionPromptCache(input.id, partyVersion, inventoryVersion, stableParty, inventorySnippet);
  }

  // Merge stable base with volatile per-turn fields (hp, status, buffs)
  const party = input.party.map((c, i) => ({
    ...stableParty[i],
    hp: c.hp,
    status: (c.status ?? 'active') as 'active' | 'downed',
    ...(c.buffs && c.buffs.length > 0 && { buffs: c.buffs }),
  }));

  // Stable fields first so JSON.stringify produces a consistent prefix for provider prompt caching.
  // Volatile fields (actionResult, recentHistory, scenePressure/Momentum, etc.) come after.
  return {
    // --- stable: rarely or never change between consecutive turns ---
    scene: input.scene,
    tone: input.tone,
    gameMode: input.gameMode,
    ...(compactedDmPrep && { dmPrep: compactedDmPrep }),
    ...(!isActiveEncounter && input.dmPrepEncounters && input.dmPrepEncounters.length > 0 && { dmPrepEncounters: input.dmPrepEncounters }),
    inventory: inventorySnippet,
    storySummary: input.storySummary || undefined,
    isFirstTurn: input.turn === 1,
    party,
    // --- volatile: changes every turn ---
    actingCharacterName: actingChar?.name,
    nextCharacterName: nextChar?.name,
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
    ...(input.scenePressure && { scenePressure: input.scenePressure }),
    ...(input.sceneMomentum && { sceneMomentum: input.sceneMomentum }),
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
    interventionRescue: input.interventionRescue,
    sanctuaryRecovery: input.sanctuaryRecovery,
  };
}

export class AiDmService {
  public static async generateTurnResult(input: AIInput, callbacks?: NarrationStreamCallbacks): Promise<TurnResult> {
    const totalStart = Date.now();
    const narrationInput = toNarrationInput(input);
    devLog.log([
      '[AiDm] narration-input',
      `sessionTurn=${input.turn}`,
      `durationMs=${Date.now() - totalStart}`,
      `party=${narrationInput.party.length}`,
      `inventory=${narrationInput.inventory.length}`,
      `history=${narrationInput.recentHistory.length}`,
      `choices=${narrationInput.previousChoiceLabels?.length ?? 0}`,
      `dmPrepChars=${narrationInput.dmPrep?.length ?? 0}`,
      `dmPrepCompiled=${input.compiledDmPrep ? 'true' : 'false'}`,
      `encounters=${narrationInput.dmPrepEncounters?.length ?? 0}`,
      `hasEncounterState=${narrationInput.encounterState ? 'true' : 'false'}`,
      `momentum=${narrationInput.sceneMomentum?.directive ?? 'none'}`,
    ].join(' '));
    try {
      const config = getConfig();
      let output: NarrationOutput;
      if (config.NARRATION_WORKFLOW === 'agentic') {
        devLog.log(`[AiDm] workflow=agentic sessionTurn=${input.turn}`);
        const orchestrator = new DmTurnOrchestrator();
        output = await orchestrator.orchestrate(narrationInput, callbacks);
      } else {
        const provider = createNarrationProvider();
        output = await provider.generateTurn(narrationInput, callbacks);
      }
      devLog.log(`[AiDm] provider-done sessionTurn=${input.turn} durationMs=${Date.now() - totalStart}`);

      return {
        narration: output.narration,
        choices: output.choices,
        rollNarration: output.rollNarration,
        imagePrompt: null,
        imageSuggested: false,
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
        choicesFailed: (output as DmTurnOrchestratorResult).choicesFailed ?? false,
        narrationValidationError: output.narrationValidationError,
        narrationRetryValidationError: output.narrationRetryValidationError,
        imageUrl: null,
      };
    } catch (error: unknown) {
      devLog.log(`[AiDm] provider-error sessionTurn=${input.turn} durationMs=${Date.now() - totalStart}`);
      const status = (error as { status?: number })?.status;
      if (status === 429) {
        throw error;
      }
      devLog.error('Error calling AI service:', error);
      const fallbackError = (() => {
        if (error instanceof Error) {
          const constructorName = error.constructor?.name ?? '';
          if (constructorName === 'APIUserAbortError') {
            return `timeout (abort signal fired)`;
          }
          return error.message;
        }
        return String(error);
      })();
      return {
        ...buildNarrationFallback(narrationInput),
        imagePrompt: null,
        imageSuggested: false,
        narrationFailed: true,
        narrationValidationError: fallbackError,
        imageUrl: null,
      };
    }
  }
}
