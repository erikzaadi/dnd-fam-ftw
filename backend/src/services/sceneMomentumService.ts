import type { ActionAttempt, SceneMomentum, ScenePressure, SessionState, TurnResult } from '../types.js';

const PRESSURE_RE = /\b(ambush|battle|boss|brawl|challenge|chase|combat|conflict|defeat|disarm|duel|enemy|escape|fight|foe|guard|guardian|hazard|monster|obstacle|puzzle|riddle|ritual|shadow|shadows|sneak|spectral|strike|trap|wolf|wolves)\b/i;
const COMBAT_RE = /\b(ambush|attack|battle|boss|brawl|combat|duel|enemy|fight|foe|monster|strike|wolf|wolves)\b/i;
const RESOLVED_PRESSURE_RE = /\b(last (?:of the )?(?:enemy|enemies|foe|foes|cultists?|shadowkin|shadows?) (?:is |are )?(?:defeated|vanquished|banished|gone|falls?|collapses?)|(?:enemy|enemies|foe|foes|cultists?|shadowkin|shadows?) (?:are |is )?(?:defeated|vanquished|banished)|path (?:ahead )?(?:is )?(?:clear|opens?|reveals?)|with the .* (?:defeated|vanquished|banished)|victorious)\b/i;

const GENERIC_CHOICE_RE = /\b(attack|strike|search|inspect|look|wait|listen|rest|discuss)\b/i;

function normalizeChoiceLabel(label: string): string {
  return label.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function actionPressureKind(actionAttempt: string, currentScene: string): ScenePressure['kind'] {
  const currentText = `${actionAttempt} ${currentScene}`;
  if (COMBAT_RE.test(currentText)) {
    return 'combat';
  }
  if (PRESSURE_RE.test(currentText)) {
    return 'challenge';
  }
  return 'unknown';
}

export function turnPressureKind(turn: TurnResult): ScenePressure['kind'] {
  const text = [
    turn.narration,
    turn.lastAction?.actionAttempt,
    turn.rollNarration,
    ...(turn.choices ?? []).map(choice => `${choice.label} ${choice.narration ?? ''}`),
  ].join(' ');

  if (RESOLVED_PRESSURE_RE.test(text)) {
    return 'calm';
  }
  if (COMBAT_RE.test(text)) {
    return 'combat';
  }
  if (PRESSURE_RE.test(text) || turn.currentTensionLevel === 'high') {
    return 'challenge';
  }
  if (turn.currentTensionLevel === 'low') {
    return 'calm';
  }
  return 'unknown';
}

export function buildScenePressure(
  history: TurnResult[],
  currentAction: ActionAttempt,
  currentScene: string,
): ScenePressure {
  const recent = history.slice(-4);
  const previousTensionLevels = recent
    .map(turn => turn.currentTensionLevel)
    .filter((level): level is ScenePressure['previousTensionLevels'][number] => !!level);
  const recentKinds = recent.map(turnPressureKind);
  const currentKind = actionPressureKind(currentAction.actionAttempt, currentScene);
  const kind: ScenePressure['kind'] = currentKind !== 'unknown'
    ? currentKind
    : recentKinds.find(k => k === 'combat') ?? recentKinds.find(k => k === 'challenge') ?? recentKinds.at(-1) ?? 'unknown';
  const pressureTurns = [...recentKinds, currentKind].filter(k => k === 'combat' || k === 'challenge').length;
  const successfulPressureTurns = recent.filter(turn => {
    const lastAction = turn.lastAction;
    return !!lastAction?.actionResult.success && (turnPressureKind(turn) === 'combat' || turnPressureKind(turn) === 'challenge');
  }).length + (currentAction.actionResult.success && (currentKind === 'combat' || currentKind === 'challenge') ? 1 : 0);
  return {
    kind,
    pressureTurns,
    successfulPressureTurns,
    previousTensionLevels,
    reason: 'Scene pressure computed.',
  };
}

function turnsSinceKind(history: TurnResult[], kind: ScenePressure['kind']): number {
  const index = history.slice().reverse().findIndex(turn => turnPressureKind(turn) === kind);
  return index === -1 ? history.length + 1 : index + 1;
}

function countSameSceneTurns(history: TurnResult[], kind: ScenePressure['kind']): number {
  let count = 1;
  for (const turn of history.slice().reverse()) {
    if (turnPressureKind(turn) !== kind) {
      break;
    }
    count++;
  }
  return count;
}

function countStaleChoices(session: SessionState): number {
  const labels = session.lastChoices.map(choice => normalizeChoiceLabel(choice.label));
  const uniqueLabels = new Set(labels);
  const repeatedLabels = labels.length - uniqueLabels.size;
  const genericLabels = labels.filter(label => GENERIC_CHOICE_RE.test(label)).length;
  return repeatedLabels + genericLabels;
}

function isDifficultChallenge(action: ActionAttempt, pressure: ScenePressure, currentActionKind: ScenePressure['kind']): boolean {
  return action.actionResult.success &&
    currentActionKind === 'challenge' &&
    pressure.kind === 'challenge' &&
    (action.actionResult.difficultyTarget ?? 0) >= 13;
}

function suggestedNextBeatFor(input: {
  directive: SceneMomentum['directive'];
  pressure: ScenePressure;
  justCompletedDifficultChallenge: boolean;
  pendingSeedName?: string;
  gameMode?: string;
}): string {
  if (input.directive === 'victory_exit') {
    if (input.gameMode === 'zug-ma-geddon') {
      return 'New enemies arrive immediately - set suggestedEncounterStart now with fresh combatants. There is no pause between battles in zug-ma-geddon.';
    }
    if (input.gameMode === 'fast') {
      return 'Carry the party out of the defeated encounter - new danger should arrive within 1-2 turns. Set suggestedEncounterStart with fresh enemies if the situation calls for it.';
    }
    if (input.justCompletedDifficultChallenge) {
      return 'Carry the party past the completed challenge into the reward, clue, route, or visible consequence it unlocked.';
    }
    return 'Carry the party away from the defeated encounter into the next room, clue, route, reward, or visible threat.';
  }
  if (input.directive === 'close_combat') {
    return 'End the current fight decisively with surrender, retreat, defeat, or a finishing beat that opens the next route.';
  }
  if (input.pendingSeedName) {
    return `The prepared encounter "${input.pendingSeedName}" is ready and the approach has gone on long enough. Use suggestedEncounterStart now: set name to exactly "${input.pendingSeedName}", use the seed enemy names and roles from dmPrepEncounters, and commit to the confrontation this turn. Do not narrate another approach beat.`;
  }
  if (input.directive === 'advance_campaign') {
    return 'Introduce a concrete new beat: a location, clue, NPC move, visible threat, trap, chase, or strange discovery.';
  }
  if (input.directive === 'climax_pressure') {
    return 'Connect this turn to the main threat and push toward a climactic confrontation.';
  }
  if (input.pressure.kind === 'challenge') {
    return 'Keep the current challenge active, but change the object, hazard, route, or tactical shape of the action.';
  }
  return 'Start a concrete scene beat with a clear object, route, NPC, clue, or threat to act on.';
}

function findPendingSeedName(session: SessionState): string | undefined {
  const seeds = session.dmPrepEncounters;
  if (!seeds?.length || session.encounterState?.status === 'active') {
    return undefined;
  }
  const resolvedNames = new Set(
    (session.pastEncounters ?? []).map(e => e.name.trim().toLowerCase())
  );
  return seeds.find(s => !resolvedNames.has(s.name.trim().toLowerCase()))?.name;
}

export function buildSceneMomentum(
  history: TurnResult[],
  currentAction: ActionAttempt,
  session: SessionState,
  scenePressure: ScenePressure,
): SceneMomentum {
  const staleChoiceCount = countStaleChoices(session);
  const currentActionKind = actionPressureKind(currentAction.actionAttempt, session.scene);
  const justCompletedCombat = currentAction.actionResult.success &&
    currentActionKind === 'combat' &&
    scenePressure.kind === 'combat' &&
    scenePressure.successfulPressureTurns >= 2;
  const justCompletedDifficultChallenge = isDifficultChallenge(currentAction, scenePressure, currentActionKind);
  const turnsSinceSceneChange = countSameSceneTurns(history, scenePressure.kind);
  const turnsSinceCombat = turnsSinceKind(history, 'combat');
  const mode = session.gameMode ?? 'balanced';
  const staleThreshold = mode === 'zug-ma-geddon' ? 1 : mode === 'fast' ? 2 : mode === 'balanced' ? 4 : 5;
  const shouldAdvance = staleChoiceCount >= 2 || turnsSinceSceneChange >= staleThreshold;
  const shouldClimax = scenePressure.previousTensionLevels.filter(level => level === 'high').length >= 3 &&
    !!(session.storySummary || session.dmPrep);
  const directive: SceneMomentum['directive'] = justCompletedCombat || justCompletedDifficultChallenge
    ? 'victory_exit'
    : currentActionKind === 'combat' && scenePressure.kind === 'combat' && currentAction.actionResult.success
      ? 'close_combat'
      : shouldClimax
        ? 'climax_pressure'
        : shouldAdvance
          ? 'advance_campaign'
          : scenePressure.kind === 'combat' || scenePressure.kind === 'challenge'
            ? 'press_current_scene'
            : 'start_scene';

  // When the scene has been in pressure past the stale threshold and an unresolved
  // seed exists, override suggestedNextBeat to force the AI to commit to the encounter.
  const pendingSeedName = (shouldAdvance && (scenePressure.kind === 'combat' || scenePressure.kind === 'challenge'))
    ? findPendingSeedName(session)
    : undefined;

  return {
    directive,
    staleChoiceCount,
    turnsSinceSceneChange,
    turnsSinceCombat,
    justCompletedCombat,
    justCompletedDifficultChallenge,
    suggestedNextBeat: suggestedNextBeatFor({ directive, pressure: scenePressure, justCompletedDifficultChallenge, pendingSeedName, gameMode: mode }),
    reason: `Deterministic momentum: pressure=${scenePressure.kind}, staleChoices=${staleChoiceCount}, turnsSinceSceneChange=${turnsSinceSceneChange}, successfulPressureTurns=${scenePressure.successfulPressureTurns}.`,
  };
}
