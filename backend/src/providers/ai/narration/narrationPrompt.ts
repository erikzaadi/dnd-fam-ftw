import type { NarrationInput } from './NarrationProvider.js';

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

export function buildNarrationUserContent(input: NarrationInput): string {
  if (input.interventionRescue) {
    return '[INTERVENTION] The entire party was just knocked out and nearly lost forever. A mysterious magical force intervened at the last second: a dragon swooped in, time rewound, a divine blessing struck, or some gloriously absurd coincidence saved them. Write a dramatic, surprising rescue (2-3 sentences). Every party member is now alive but barely standing at 1 HP. Then provide 3 fresh choices for the battered-but-breathing party to continue.\n\n' + JSON.stringify(input);
  }
  if (input.sanctuaryRecovery) {
    return '[SANCTUARY] The party has been defeated again - their one miraculous rescue already spent. They have somehow survived and woken up somewhere safe and quiet: a cave, a friendly inn, a mossy clearing, a healer\'s hut. They are battered, humbled, and at 1 HP each - but alive. Write a brief (2-3 sentences) scene of coming to in this safe place, with a hint of what went wrong. Give 3 choices for what the party does next from this sanctuary.\n\n' + JSON.stringify(input);
  }
  const scenarioPrefix = input.isFirstTurn
    ? '[OPENING SCENE] This is the very start of the adventure. Write a vivid opening that sets the world and hooks the party. Do NOT reference prior events or continuations.\n\n'
    : '';
  return scenarioPrefix + JSON.stringify(input);
}
