import { devLog } from '../lib/devLog.js';
import type { NarrationOutput } from '../providers/ai/narration/NarrationProvider.js';
import type { ActionAttempt, SessionState } from '../types.js';

type TurnResult = Awaited<ReturnType<typeof import('./aiDmService.js').AiDmService.generateTurnResult>>;

// Verb phrases that strongly imply the party GAINED an item this turn.
const GAIN_VERBS = /\b(finds?|found|receives?|received|obtains?|obtained|loots?|looted|claims?|claimed|picks? up|picked up|harvests?|harvested|crafted?|bought|purchases?|purchased|rewarded|is given|are given|hands? .{0,20} over|takes? .{0,20} from)\b/i;

// Verb phrases that strongly imply an item LEFT the party this turn.
const LOSS_VERBS = /\b(stolen|steals?|loses?|lost|gives? away|gives? .{0,20} to|hands? .{0,20} to|trades? away|traded away|sacrifices?|sacrificed|taken by|snatched|drops? and loses?)\b/i;

// Phrases that imply a downed character was revived.
const REVIVAL_PHRASES = /\b(revived?|reviving|wakes? up|woke up|opens? (?:his|her|their) eyes?|stirs? and rises?|stands? (?:up )?restored|back on (?:his|her|their) feet|breathes? again|consciousness returns?|returns? to consciousness)\b/i;

// Phrases that imply a new combat encounter is starting.
const ENCOUNTER_START_PHRASES = /\b(enemies? (?:appear|emerge|burst|rush|charge|ambush)|foes? (?:appear|emerge|step out)|attackers? (?:appear|emerge|charge)|combat begins?|battle begins?|fight breaks? out|ambush(?:ed)?|ambush springs?|they attack|the (?:\w+ ){0,3}(?:lunges?|charges?|strikes? first)|the party is surrounded)\b/i;

function checkItemGain(narration: string, result: NarrationOutput): void {
  if (result.suggestedInventoryAdd !== null) {
    return;
  }
  if (GAIN_VERBS.test(narration)) {
    devLog.warn('[Consistency] narration implies item gain but suggestedInventoryAdd is null - inventory module may have missed it');
  }
}

function checkItemLoss(narration: string, result: NarrationOutput): void {
  if (result.suggestedInventoryRemove !== null) {
    return;
  }
  if (LOSS_VERBS.test(narration)) {
    devLog.warn('[Consistency] narration implies item loss but suggestedInventoryRemove is null - log only, no auto-synthesis');
  }
}

function checkRevival(narration: string, result: NarrationOutput, session: SessionState): void {
  if (result.suggestedRevive !== null) {
    return;
  }
  const hasDownedMember = session.party.some(c => c.status === 'downed');
  if (!hasDownedMember) {
    return;
  }
  if (REVIVAL_PHRASES.test(narration)) {
    devLog.warn('[Consistency] narration implies revival of downed character but suggestedRevive is null - game engine revive fallback will attempt repair');
  }
}

function checkEncounterStart(
  narration: string,
  result: NarrationOutput,
  session: SessionState,
  actionAttempt: ActionAttempt,
): void {
  if (result.suggestedEncounterStart !== null) {
    return;
  }
  if (session.encounterState?.status === 'active') {
    return;
  }
  if (ENCOUNTER_START_PHRASES.test(narration) || ENCOUNTER_START_PHRASES.test(actionAttempt.actionAttempt)) {
    devLog.warn('[Consistency] narration implies encounter start but suggestedEncounterStart is null - deterministic inference will attempt repair');
  }
}

export function checkTurnResultConsistency(
  result: TurnResult,
  session: SessionState,
  actionAttempt: ActionAttempt,
): void {
  const narration = result.narration ?? '';
  checkItemGain(narration, result as unknown as NarrationOutput);
  checkItemLoss(narration, result as unknown as NarrationOutput);
  checkRevival(narration, result as unknown as NarrationOutput, session);
  checkEncounterStart(narration, result as unknown as NarrationOutput, session, actionAttempt);
}
