import type { NarrationInput } from './NarrationProvider.js';
import { isTradeTurn, isRiddleTurn } from './narrationPrompt.js';
import {
  SECTION_PREAMBLE_PACING_TENSION,
  SECTION_MOMENTUM_DIRECTIVES,
  SECTION_COMBAT_PACING,
  SECTION_ACTIVE_ENCOUNTER,
  SECTION_FAIL_FORWARD,
  SECTION_REST_RECOVERY,
  SECTION_DRAMA_ROLL,
  SECTION_CONTINUITY_SHORT,
  SECTION_ACTING_SHORT,
  SECTION_CHOICES_FORMAT,
  SECTION_CHOICES_RIDDLE,
  SECTION_CHOICES_VENDOR,
  SECTION_DIFFICULTY_SHORT,
  SECTION_CHOICE_VARIETY,
  SECTION_PARTY_STATUS,
  SECTION_DAMAGE_FAILURE,
  SECTION_REVIVAL_HEALING,
  SECTION_BUFFS_CURSES_FORMAT,
  SECTION_SUPPORT_ACTION_PAYOFF,
  SECTION_ACTION_INTENT,
  SECTION_INVENTORY_BASICS,
  SECTION_INVENTORY_COMBAT_LOOT,
  SECTION_INVENTORY_TRADE,
  SECTION_FROZEN_CONFRONTATION,
  SECTION_LOCATION_STALL,
  SECTION_ACTION_INTENT_INVENTORY,
  SECTION_CHOICES_CONTINUITY,
  SECTION_CHOICES_CONTINUITY_COMBAT,
  SECTION_ACTIVE_COMBAT_CHOICES,
  SECTION_POST_ENCOUNTER_CHOICES,
} from './narrationPromptSections.js';

const ACTIVE_ENCOUNTER_NARRATION_CONTEXT = `ACTIVE ENCOUNTER - Narration Context:
- The party is in a tracked combat encounter. Reference enemies and areas vividly in your narration.
- Describe action consequences: direct hits, near misses, enemy reactions, environmental details.
- Do NOT set suggestedEncounterUpdate, suggestedDamage, or suggestedEncounterStart in your output - those are handled by a separate combat module.
- Do NOT invent enemies outside the active encounter's enemy list.
- Reference revealed weaknesses when the story supports exploiting them.`;

const TYPOGRAPHY_RULE = `CRITICAL - Typography: NEVER use em dashes in any output field. Use a comma, colon, or hyphen instead.`;

const BUFF_ACTION_INTENTS = new Set(['bless_character', 'aid_character', 'party_boost']);

function isBuffTurn(input: NarrationInput): boolean {
  if (input.actionIntent && BUFF_ACTION_INTENTS.has(input.actionIntent)) {
    return true;
  }
  return input.party.some(c => c.buffs && c.buffs.length > 0);
}

function isRestTurn(input: NarrationInput): boolean {
  return !!(input.sanctuaryRecovery || input.interventionRescue);
}

export function buildNarrationAgentSystemPrompt(input: NarrationInput): string {
  const isActiveCombat = input.encounterState?.status === 'active';
  const hasMomentum = input.sceneMomentum !== undefined;
  const hasDramaRoll = input.actionResult.statUsed !== undefined;
  const hasFrozen = input.storySummary?.includes('FROZEN CONFRONTATION');
  const hasStall = input.storySummary?.includes('LOCATION STALL');

  const sections = [
    'You are a thrilling and slightly edgy fantasy DM writing the narrative outcome for this turn.',
    'Your output contains ONLY three fields: rollNarration, narration, and currentTensionLevel.',
    'Do NOT produce choices, inventory changes, encounter state changes, HP changes, or buffs.',
    'Those fields are handled by separate modules running in parallel.',
    TYPOGRAPHY_RULE,
    SECTION_PREAMBLE_PACING_TENSION,
    ...(hasMomentum ? [SECTION_MOMENTUM_DIRECTIVES] : []),
    ...(isActiveCombat ? [SECTION_COMBAT_PACING, ACTIVE_ENCOUNTER_NARRATION_CONTEXT] : []),
    SECTION_FAIL_FORWARD,
    ...(hasDramaRoll ? [SECTION_DRAMA_ROLL] : []),
    SECTION_CONTINUITY_SHORT,
    SECTION_ACTING_SHORT,
    ...(hasFrozen ? [SECTION_FROZEN_CONFRONTATION] : []),
    ...(hasStall ? [SECTION_LOCATION_STALL] : []),
  ];

  return sections.join('\n\n');
}

const DEFEATED_FOES_RULE = `DEFEATED FOES: resolvedEncounterEnemyNames lists enemies that are already defeated, fled, or surrendered. They are gone from the story. Never create choices that attack, pursue, guard against, or otherwise reference them. Build choices around what comes next: new locations, NPCs, clues, or fresh obstacles.`;

export function buildChoicesAgentSystemPrompt(input: NarrationInput): string {
  const isActiveCombat = input.encounterState?.status === 'active';
  // Mirror the hasEncounterStartSignal logic from the orchestrator: combat agent will
  // start an encounter this turn, so choices must be combat-ready for the next turn.
  const encounterStarting = !isActiveCombat && (
    (input.sceneMomentum?.suggestedNextBeat ?? '').includes('suggestedEncounterStart') ||
    input.sceneMomentum?.directive === 'climax_pressure' ||
    input.gameMode === 'zug-ma-geddon'
  );
  const isEncounterResolution = !isActiveCombat && !!input.encounterJustResolved;
  const tradeEnabled = isTradeTurn(input);
  const riddleEnabled = isRiddleTurn(input);
  const hasResolvedFoes = !!input.resolvedEncounterEnemyNames?.length;
  // Suppress story-pacing sections during active combat or the resolution turn: the fight/victory is the current beat.
  const hasStall = !isActiveCombat && !isEncounterResolution && !!input.storySummary?.includes('LOCATION STALL');
  const hasFrozen = !isActiveCombat && !isEncounterResolution && !!input.storySummary?.includes('FROZEN CONFRONTATION');

  const sections = [
    'You are a fantasy DM producing exactly 3 action choices for the next character\'s turn.',
    'Your output contains ONLY one field: choices (exactly 3 items).',
    'Do NOT produce narration text, rollNarration, currentTensionLevel, or any state changes.',
    'Generate choices appropriate for the turn outcome indicated by actionResult and the current scene.',
    ...(hasResolvedFoes ? [DEFEATED_FOES_RULE] : []),
    SECTION_CHOICES_FORMAT,
    SECTION_DIFFICULTY_SHORT,
    ...(isActiveCombat ? [SECTION_COMBAT_PACING, SECTION_ACTIVE_COMBAT_CHOICES] : []),
    ...(isEncounterResolution ? [SECTION_POST_ENCOUNTER_CHOICES] : []),
    ...(encounterStarting ? ['ENCOUNTER STARTING: `encounterStartExpected: true` means an encounter begins this turn. Generate at least 2 combat-ready choices for `nextCharacterName`: attack, defend, use a special ability, exploit a weakness, or use the environment tactically. Do NOT generate exploration or investigation choices - the party is entering a fight.'] : []),
    SECTION_ACTING_SHORT,
    SECTION_CHOICE_VARIETY,
    ...(isActiveCombat ? [SECTION_CHOICES_CONTINUITY_COMBAT] : [SECTION_CHOICES_CONTINUITY]),
    ...(hasStall ? [SECTION_LOCATION_STALL] : []),
    ...(hasFrozen ? [SECTION_FROZEN_CONFRONTATION] : []),
    ...(riddleEnabled ? [SECTION_CHOICES_RIDDLE] : []),
    ...(tradeEnabled ? [SECTION_CHOICES_VENDOR] : []),
    SECTION_PARTY_STATUS,
    TYPOGRAPHY_RULE,
  ];

  return sections.join('\n\n');
}

export function buildCombatAgentSystemPrompt(_input: NarrationInput): string {
  const sections = [
    'You are the combat resolution module for a fantasy DM system.',
    'Your output contains ONLY three fields: suggestedDamage, suggestedEncounterStart, suggestedEncounterUpdate.',
    'Do NOT produce narration, rollNarration, choices, inventory changes, HP healing, or buffs.',
    'Evaluate the combat action result and update encounter state accordingly.',
    SECTION_COMBAT_PACING,
    SECTION_ACTIVE_ENCOUNTER,
    SECTION_DAMAGE_FAILURE,
  ];

  return sections.join('\n\n');
}

export function buildInventoryAgentSystemPrompt(input: NarrationInput): string {
  const isActiveCombat = input.encounterState?.status === 'active';
  const isLootTurn = isActiveCombat || !!input.encounterJustResolved;
  const tradeEnabled = isTradeTurn(input);
  const isEnchantTurn = input.actionIntent === 'improve_item';

  const sections = [
    'You are the inventory resolution module for a fantasy DM system.',
    'Your output contains ONLY three fields: suggestedInventoryAdd, suggestedInventoryRemove, suggestedInventoryUpdate.',
    'Do NOT produce narration, rollNarration, choices, encounter changes, HP changes, or buffs.',
    'Evaluate what items should change as a result of this turn.',
    'If the action context implies an item was stolen, lost, traded, or sacrificed, set suggestedInventoryRemove for that item.',
    SECTION_INVENTORY_BASICS,
    ...(isLootTurn ? [SECTION_INVENTORY_COMBAT_LOOT] : []),
    ...(tradeEnabled ? [SECTION_INVENTORY_TRADE] : []),
    ...(isEnchantTurn ? [SECTION_ACTION_INTENT_INVENTORY] : []),
  ];

  return sections.join('\n\n');
}

export function buildRecoveryAgentSystemPrompt(input: NarrationInput): string {
  const restTurn = isRestTurn(input);
  const buffTurn = isBuffTurn(input);
  const isBuffIntent = input.actionIntent
    ? BUFF_ACTION_INTENTS.has(input.actionIntent)
    : false;

  const sections = [
    'You are the recovery and effects resolution module for a fantasy DM system.',
    'Your output contains ONLY four fields: suggestedRevive, suggestedHeal, suggestedBuffAdd, suggestedBuffRemove.',
    'Do NOT produce narration, rollNarration, choices, encounter changes, or inventory changes.',
    'Evaluate healing, revival, and buff/curse effects for this turn.',
    ...(restTurn ? [SECTION_REST_RECOVERY] : []),
    SECTION_REVIVAL_HEALING,
    ...(buffTurn ? [SECTION_BUFFS_CURSES_FORMAT] : []),
    ...(isBuffIntent ? [SECTION_SUPPORT_ACTION_PAYOFF, SECTION_ACTION_INTENT] : []),
    SECTION_PARTY_STATUS,
  ];

  return sections.join('\n\n');
}
