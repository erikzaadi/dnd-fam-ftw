import type { NarrationInput } from './NarrationProvider.js';
import { devLog } from '../../../lib/devLog.js';
import {
  SECTION_PREAMBLE_PACING_TENSION,
  SECTION_MOMENTUM_DIRECTIVES,
  SECTION_COMBAT_PACING,
  SECTION_ACTIVE_ENCOUNTER,
  SECTION_FAIL_FORWARD,
  SECTION_REST_RECOVERY,
  SECTION_CUTE_CONDITIONS_BUFFS,
  SECTION_CHOICES_FORMAT,
  SECTION_CHOICES_RIDDLE,
  SECTION_CHOICES_VENDOR,
  SECTION_DRAMA_ROLL,
  SECTION_DIFFICULTY_SHORT,
  SECTION_CONTINUITY_SHORT,
  SECTION_ACTING_SHORT,
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
} from './narrationPromptSections.js';

const BUFF_ACTION_INTENTS = ['bless_character', 'aid_character', 'party_boost', 'improve_item'];

function isBuffTurn(input: NarrationInput): boolean {
  if (input.actionIntent && BUFF_ACTION_INTENTS.includes(input.actionIntent)) {
    return true;
  }
  return input.party.some(c => c.buffs && c.buffs.length > 0);
}

function isRestTurn(input: NarrationInput): boolean {
  return !!(input.sanctuaryRecovery || input.interventionRescue);
}

const TRADE_RE = /\b(vendor|merchant|trade|shop|barter|buy|sell|purchase|dealer|stall|give|pass|hand over|transfer)\b/i;

export function isTradeTurn(input: NarrationInput): boolean {
  const isActiveCombat = input.encounterState?.status === 'active';
  // Action text always counts, even mid-combat (explicit give/trade during combat is valid)
  if (TRADE_RE.test(input.actionAttempt)) {
    return true;
  }
  // During active combat, scene and history signals are stale context - skip them
  if (isActiveCombat) {
    return false;
  }
  // Outside combat: only look at the last 2 history entries to avoid stale vendor activation
  if (input.recentHistory.slice(-2).some(h => TRADE_RE.test(h))) {
    return true;
  }
  if (input.scene && TRADE_RE.test(input.scene)) {
    return true;
  }
  return false;
}

const RIDDLE_RE = /\b(riddle|puzzle|pun|password|cipher|code|answer-based)\b/i;

export function isRiddleTurn(input: NarrationInput): boolean {
  // Scene and action are authoritative current-turn signals
  if (RIDDLE_RE.test(input.scene)) {
    return true;
  }
  if (RIDDLE_RE.test(input.actionAttempt)) {
    return true;
  }
  // Only the last 2 history entries - avoids reactivating riddle rules from a
  // puzzle that was solved several turns ago
  if (input.recentHistory.slice(-2).some(h => RIDDLE_RE.test(h))) {
    return true;
  }
  // dmPrep alone is not enough - it covers the full campaign brief and may mention
  // riddles that are long resolved. Require a current-turn signal instead.
  return false;
}

export function buildNarrationSystemPrompt(input: NarrationInput): string {
  const isActiveCombat = input.encounterState?.status === 'active';
  const isLootTurn = isActiveCombat || !!input.encounterJustResolved;
  const tradeEnabled = isTradeTurn(input);
  const riddleEnabled = isRiddleTurn(input);
  const hasMomentum = input.sceneMomentum !== undefined;
  const hasDramaRoll = input.actionResult.statUsed !== undefined;
  const restTurn = isRestTurn(input);
  const buffTurn = isBuffTurn(input);
  const hasDownedOrHealing = restTurn || input.party.some(c => c.status === 'downed');
  const inventoryRelevant = input.inventory.length > 0 || isLootTurn || tradeEnabled;
  const hasFrozen = input.storySummary?.includes('FROZEN CONFRONTATION');
  const hasStall = input.storySummary?.includes('LOCATION STALL');

  const sections: string[] = [
    SECTION_PREAMBLE_PACING_TENSION,
    ...(hasMomentum ? [SECTION_MOMENTUM_DIRECTIVES] : []),
    ...(isActiveCombat ? [SECTION_COMBAT_PACING, SECTION_ACTIVE_ENCOUNTER] : []),
    SECTION_FAIL_FORWARD,
    ...(restTurn ? [SECTION_REST_RECOVERY] : []),
    ...(buffTurn ? [SECTION_CUTE_CONDITIONS_BUFFS] : []),
    SECTION_CHOICES_FORMAT,
    ...(hasDramaRoll ? [SECTION_DRAMA_ROLL] : []),
    SECTION_DIFFICULTY_SHORT,
    SECTION_CONTINUITY_SHORT,
    ...(hasFrozen ? [SECTION_FROZEN_CONFRONTATION] : []),
    ...(hasStall ? [SECTION_LOCATION_STALL] : []),
    SECTION_ACTING_SHORT,
    SECTION_CHOICE_VARIETY,
    ...(riddleEnabled ? [SECTION_CHOICES_RIDDLE] : []),
    ...(tradeEnabled ? [SECTION_CHOICES_VENDOR] : []),
    SECTION_PARTY_STATUS,
    ...(hasDramaRoll || isActiveCombat ? [SECTION_DAMAGE_FAILURE] : []),
    ...(hasDownedOrHealing ? [SECTION_REVIVAL_HEALING] : []),
    ...(buffTurn ? [SECTION_BUFFS_CURSES_FORMAT, SECTION_SUPPORT_ACTION_PAYOFF, SECTION_ACTION_INTENT] : []),
    ...(inventoryRelevant ? [SECTION_INVENTORY_BASICS] : []),
    ...(isLootTurn ? [SECTION_INVENTORY_COMBAT_LOOT] : []),
    ...(tradeEnabled ? [SECTION_INVENTORY_TRADE] : []),
  ];

  const includedKeys = [
    'PREAMBLE_PACING_TENSION',
    ...(hasMomentum ? ['MOMENTUM_DIRECTIVES'] : []),
    ...(isActiveCombat ? ['COMBAT_PACING', 'ACTIVE_ENCOUNTER'] : []),
    'FAIL_FORWARD',
    ...(restTurn ? ['REST_RECOVERY'] : []),
    ...(buffTurn ? ['CUTE_CONDITIONS_BUFFS'] : []),
    'CHOICES_FORMAT',
    ...(hasDramaRoll ? ['DRAMA_ROLL'] : []),
    'DIFFICULTY_SHORT',
    'CONTINUITY_SHORT',
    ...(hasFrozen ? ['FROZEN_CONFRONTATION'] : []),
    ...(hasStall ? ['LOCATION_STALL'] : []),
    'ACTING_SHORT',
    'CHOICE_VARIETY',
    ...(riddleEnabled ? ['CHOICES_RIDDLE'] : []),
    ...(tradeEnabled ? ['CHOICES_VENDOR'] : []),
    'PARTY_STATUS',
    ...(hasDramaRoll || isActiveCombat ? ['DAMAGE_FAILURE'] : []),
    ...(hasDownedOrHealing ? ['REVIVAL_HEALING'] : []),
    ...(buffTurn ? ['BUFFS_CURSES_FORMAT', 'SUPPORT_ACTION_PAYOFF', 'ACTION_INTENT'] : []),
    ...(inventoryRelevant ? ['INVENTORY_BASICS'] : []),
    ...(isLootTurn ? ['INVENTORY_COMBAT_LOOT'] : []),
    ...(tradeEnabled ? ['INVENTORY_TRADE'] : []),
  ];
  devLog.log(`[Narration] prompt-sections count=${includedKeys.length} keys=${includedKeys.join(',')}`);

  return sections.join('\n\n');
}

export function buildNarrationRetryInstructions(validationError: string): string {
  const fixes: string[] = [
    `Revise the same turn and fix this validation error: ${validationError}`,
    'Do not lightly rephrase the rejected output. Change the story beat enough that the same guard would not fail again.',
  ];

  if (validationError.includes('Victory exit')) {
    fixes.push('For victory exits, the fight or difficult challenge is over. State the resolution in one sentence, then carry the party into a new concrete beat: a different room, route, clue, NPC, reward, visible consequence, or named location. At least two choices must act inside that new beat, and at most one choice may sound defensive or combat-ready.');
  }

  if (validationError.includes('Hidden-path beat repeats')) {
    fixes.push('For hidden-path loops, stop discovering another hidden path. Pay off the existing path now: arrive somewhere specific, reveal a concrete clue, introduce an NPC with new information, unlock a named obstacle, or show a clear consequence of taking the route.');
  }

  if (validationError.includes('Output revives recently resolved threat')) {
    const nameMatch = /Output revives recently resolved threat: "([^"]+)"/.exec(validationError);
    const banned = nameMatch ? nameMatch[1] : null;
    if (banned) {
      fixes.push(`HARD BAN: "${banned}" is defeated and must not appear in any form in this response - not in narration, rollNarration, or choices. Do not name it, reference it, hint at it, or use synonyms for it. Write about a completely different element: a new location, an NPC acting, a discovered object, an environmental hazard, or a faction pressure. Treat "${banned}" as if it never existed in this scene.`);
    } else {
      fixes.push('For resolved-threat repeats, do not bring back the named defeated enemy in any form. Replace it with a new location, NPC action, discovered clue, environmental hazard, or faction pressure.');
    }
  }

  if (validationError.includes('Narration repeats vague atmosphere filler')) {
    fixes.push('For repeated atmosphere, remove vague mood phrases and add a concrete fact: a name, object, wound, clue, route, location, NPC reaction, or visible consequence.');
  }

  if (validationError.includes('Narration repeats the previous turn')) {
    fixes.push('For repeated narration, start from the submitted action result and add only what changed after it. Do not restate the prior setup.');
  }

  if (validationError.includes('system instruction fragment')) {
    fixes.push('Your narration echoed a private backend instruction verbatim. Rewrite the narration as pure story prose. Do not use phrases from sceneMomentum, directive text, or turn-order mechanics. Show what happens in the world - NPC actions, environment changes, consequences, combat beats - without quoting any system guidance. The transition to the next character must emerge from story context, not stated as game mechanics.');
  }

  if (validationError.includes('Choice label repeats')) {
    fixes.push('For repeated choice labels, replace them with specific verbs plus concrete objects, routes, NPCs, hazards, or items from the current scene.');
  }

  if (validationError.includes('Item choice repeats recently suggested gear')) {
    fixes.push('For repeated gear choices, do not suggest that same item again. Offer a different carried item only if it truly fits, otherwise use a route, NPC, obstacle, clue, or standard action.');
  }

  if (validationError.includes('Item choices may only use the next actor')) {
    fixes.push('For off-owner gear choices, remove that item choice. Only suggest gear carried by nextCharacterName; if their gear does not fit, offer a route, NPC, obstacle, clue, or standard action instead.');
  }

  if (validationError.includes('No more than two bonus-bearing choices')) {
    fixes.push('For bonus-count errors, change excess combo, item, social, or spotlight choices to standard or environment choices, or replace them entirely.');
  }

  if (validationError.includes('Environment choices must include environmentFeature')) {
    fixes.push('For environment choices, include environmentFeature with a short concrete terrain, hazard, or obstacle name.');
  }

  return `\nCRITICAL: ${fixes.join(' ')}`;
}

export function buildNarrationUserContent(input: NarrationInput, validationError?: string): string {
  const retryPrefix = validationError ? buildNarrationRetryInstructions(validationError) + '\n\n' : '';
  if (input.interventionRescue) {
    return retryPrefix + '[INTERVENTION] The entire party was just knocked out and nearly lost forever. A mysterious magical force intervened at the last second: a dragon swooped in, time rewound, a divine blessing struck, or some gloriously absurd coincidence saved them. Write a dramatic, surprising rescue (2-3 sentences). Every party member is now alive but barely standing at 1 HP. Then provide 3 fresh choices for the battered-but-breathing party to continue.\n\n' + JSON.stringify(input);
  }
  if (input.sanctuaryRecovery) {
    return retryPrefix + '[SANCTUARY] The party has been defeated again - their one miraculous rescue already spent. They have somehow survived and woken up somewhere safe and quiet: a cave, a friendly inn, a mossy clearing, a healer\'s hut. They are battered, humbled, and at 1 HP each - but alive. Write a brief (2-3 sentences) scene of coming to in this safe place, with a hint of what went wrong. Give 3 choices for what the party does next from this sanctuary.\n\n' + JSON.stringify(input);
  }
  const scenarioPrefix = input.isFirstTurn
    ? '[OPENING SCENE] This is the very start of the adventure. Write a vivid opening that sets the world and hooks the party. Do NOT reference prior events or continuations.\n\n'
    : '';
  return retryPrefix + scenarioPrefix + JSON.stringify(input);
}
