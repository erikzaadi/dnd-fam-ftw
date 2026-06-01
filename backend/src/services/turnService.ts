import { broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import { devLog } from '../lib/devLog.js';
import type { ActionAttempt, AIInput, Difficulty, SessionState, Stat } from '../types.js';
import { AiDmService, toNarrationInput } from './aiDmService.js';
import { DmTurnOrchestrator } from './dmTurnOrchestrator.js';
import { getConfig } from '../config/env.js';
import type { NarrationStreamCallbacks } from '../providers/ai/narration/NarrationProvider.js';
import { GameEngine } from './gameEngine.js';
import { StateService } from './stateService.js';
import { queueCompletedTurnSideEffects } from './turnSideEffectService.js';
import { compileDmPrepPremise } from './dmPrepCompilationService.js';
import { computeBuffChanges, computeEncounterEnemyChanges, computeHpChanges, computeInventoryChanges } from './turnChangeService.js';
import { resolveRiddleAnswer } from './riddleService.js';
import {
  CHARACTER_EDGE_BONUS,
  CHOICE_ITEM_BONUS,
  COMBO_HELPER_BONUS,
  type InferredFreeActionBonuses,
  inferFreeActionBonuses,
  toFreeActionBonusPreview,
} from './freeActionInferenceService.js';
import { buildSceneMomentum, buildScenePressure } from './sceneMomentumService.js';
import { ensureSuccessfulEnchantmentSuggestion, ensureSuccessfulHealingSuggestion, ensureSuccessfulSupportSuggestion, inferActionIntent } from './freeActionPolicyService.js';
import { repairEncounterNameIfNeeded } from './encounterNameRepairService.js';
import { buildRollNarration } from './rollNarrationService.js';

const logTurnStep = (sessionId: string, step: string, start: number, details = ''): number => {
  const now = Date.now();
  devLog.log(`[Turn] step session=${sessionId} ${step} durationMs=${now - start}${details ? ` ${details}` : ''}`);
  return now;
};

const getTurnEncounterId = (previousSession: SessionState, newState: SessionState): string | undefined => {
  if (previousSession.encounterState?.status === 'active') {
    return previousSession.encounterState.id;
  }
  if (newState.encounterState?.status === 'active' && previousSession.encounterState?.id !== newState.encounterState.id) {
    return newState.encounterState.id;
  }
  return undefined;
};

const encounterResolutionVerb = (status: string | undefined): string => {
  if (status === 'fled') {
    return 'breaks and flees';
  }
  if (status === 'surrendered') {
    return 'drops its guard and surrenders';
  }
  return 'collapses, defeated';
};

type PostEncounterLoot = {
  characterName: string;
  itemName: string;
};



const sentenceCase = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  return `${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
};

const extractNextPromisedBeat = (storySummary: string | undefined): string | null => {
  if (!storySummary) {
    return null;
  }
  const match = /NEXT PROMISED BEAT:\s*([^\n]+)/i.exec(storySummary);
  const beat = match?.[1]?.trim().replace(/[.?!]+$/g, '');
  return beat || null;
};

const buildPostEncounterFollowThrough = (session: SessionState): string => {
  const nextBeat = extractNextPromisedBeat(session.storySummary);
  if (nextBeat) {
    return ` Now the party can ${sentenceCase(nextBeat)}.`;
  }
  return ' A clue, route, or decision waits beyond the battlefield.';
};

const getPostEncounterLoot = (previousSession: SessionState, newState: SessionState): PostEncounterLoot[] =>
  computeInventoryChanges(previousSession.party, newState.party)
    .filter(change => change.type === 'added')
    .map(change => ({ characterName: change.characterName, itemName: change.itemName }));

const buildLootNarration = (addedLoot: PostEncounterLoot[]): string => {
  if (addedLoot.length === 0) {
    return '';
  }
  const claims = addedLoot.map(change => `${change.characterName} claims ${change.itemName}`);
  const hums = addedLoot.length === 1
    ? ` ${addedLoot[0].itemName} still hums with usable magic.`
    : ' The new spoils still hum with usable magic.';
  return ` ${claims.join(', ')} from the aftermath.${hums}`;
};

const alignTurnWithResolvedEncounter = (
  previousSession: SessionState,
  newState: SessionState,
  turnResult: Awaited<ReturnType<typeof AiDmService.generateTurnResult>>,
): void => {
  if (previousSession.encounterState?.status !== 'active' || newState.encounterState?.status === 'active') {
    return;
  }
  if (!newState.encounterState || previousSession.encounterState.id !== newState.encounterState.id) {
    return;
  }

  const resolvedEnemies = previousSession.encounterState.enemies.flatMap(beforeEnemy => {
    const afterEnemy = newState.encounterState?.enemies.find(e => e.id === beforeEnemy.id);
    if (beforeEnemy.status === 'active' && afterEnemy && afterEnemy.status !== 'active') {
      return [{ beforeEnemy, afterEnemy }];
    }
    return [];
  });
  if (resolvedEnemies.length === 0) {
    return;
  }

  const enemyNames = resolvedEnemies.map(e => e.afterEnemy.name || e.beforeEnemy.name).join(', ');
  const status = newState.encounterState.status;
  const resolution = encounterResolutionVerb(status);
  const addedLoot = getPostEncounterLoot(previousSession, newState);
  const lootNarration = buildLootNarration(addedLoot);
  const followThrough = buildPostEncounterFollowThrough(previousSession);
  turnResult.narration = `${enemyNames} ${resolution}.${lootNarration} The immediate fight is over.${followThrough}`;
  turnResult.currentTensionLevel = status === 'defeated' ? 'medium' : turnResult.currentTensionLevel;
  // AI choices for this turn already point forward - let stripChoicesTargetingDefeatedEnemies
  // clean up any stale enemy references rather than replacing with generic fallbacks.
  newState.lastChoices = turnResult.choices;
};

const stripChoicesTargetingDefeatedEnemies = (
  newState: SessionState,
  turnResult: Awaited<ReturnType<typeof AiDmService.generateTurnResult>>,
): boolean => {
  // Run for active encounters and for just-resolved encounters - newState.encounterState.enemies
  // always has updated statuses, so defeated enemies are visible in both cases.
  if (!newState.encounterState) {
    return false;
  }
  const defeatedTerms = new Set(
    newState.encounterState.enemies
      .filter(e => e.status !== 'active')
      .flatMap(e => [e.name, ...(e.aliases ?? [])].map(t => t.toLowerCase())),
  );
  if (defeatedTerms.size === 0) {
    return false;
  }
  const activeEnemies = newState.encounterState.enemies.filter(e => e.status === 'active');
  let changed = false;
  const fixedChoices = turnResult.choices.map(choice => {
    const lower = choice.label.toLowerCase();
    if (![...defeatedTerms].some(term => lower.includes(term))) {
      return choice;
    }
    changed = true;
    const target = activeEnemies[0];
    const replacement = target
      ? `Press the attack on the ${target.name}`
      : 'Hold position and stay ready';
    const replacementNarration = target
      ? `Keep the pressure on the ${target.name} while the moment allows.`
      : 'Brace and stay alert for what comes next.';
    devLog.warn(`[Guard] choice targets defeated enemy - replacing. original="${choice.label}" new="${replacement}"`);
    return {
      label: replacement,
      difficulty: choice.difficulty,
      stat: choice.stat,
      difficultyValue: choice.difficultyValue,
      narration: replacementNarration,
      flavor: 'standard' as const,
    };
  });
  if (changed) {
    turnResult.choices = fixedChoices;
    newState.lastChoices = fixedChoices;
  }
  return changed;
};

export interface TurnActionRequest {
  action: string;
  statUsed: string;
  difficulty?: string;
  difficultyValue?: number | null;
  itemId?: string;
  characterId?: string;
  ownerCharId?: string;
  targetCharacterId?: string;
  targetCharId?: string;
  actionType?: 'use_item' | 'give_item';
  actionIntent?: string;
}

export type TurnActionResult =
  | {
      ok: true;
      body: {
        actionAttempt: ActionAttempt;
        turnResult: Awaited<ReturnType<typeof AiDmService.generateTurnResult>>;
        session: SessionState;
      };
      queueSideEffects?: () => void;
    }
  | {
      ok: false;
      status: number;
      body: Record<string, unknown>;
    };

export const executeTurnAction = async (
  sessionId: string,
  namespaceId: string | undefined,
  request: TurnActionRequest,
): Promise<TurnActionResult> => {
  const turnStart = Date.now();
  let stepStart = turnStart;
  const {
    action,
    statUsed,
    difficulty,
    difficultyValue,
    itemId,
    actionIntent,
  } = request;
  const characterId = request.characterId ?? request.ownerCharId;
  const targetCharacterId = request.targetCharacterId ?? request.targetCharId;
  const actionType = request.actionType ?? (itemId && action === 'use item'
    ? 'use_item'
    : itemId && action === 'give item'
      ? 'give_item'
      : undefined);

  const sessionNamespace = StateService.getSessionNamespaceId(sessionId);
  if (!sessionNamespace || sessionNamespace !== (namespaceId ?? 'local')) {
    logTurnStep(sessionId, 'namespace-miss', stepStart);
    return { ok: false, status: 404, body: { error: 'Session not found' } };
  }
  const session = await StateService.getSession(sessionId);
  stepStart = logTurnStep(sessionId, 'load-session', stepStart);
  if (!session) {
    return { ok: false, status: 404, body: { error: 'Session not found' } };
  }

  if (session.dmPrep && !session.compiledDmPrep) {
    devLog.log(`[DmPrepCompile] no compiled premise found for session=${sessionId} dmPrepChars=${session.dmPrep.length} - compiling in background`);
    compileDmPrepPremise(session.dmPrep).then(compiled => {
      if (compiled) {
        devLog.log(`[DmPrepCompile] compiled premise stored for session=${sessionId} chars=${compiled.length}`);
        StateService.patchSession(sessionId, { compiledDmPrep: compiled }).catch(err => {
          devLog.warn(`[DmPrepCompile] failed to store compiled premise for session=${sessionId}`, err);
        });
      }
    }).catch(err => {
      devLog.warn(`[DmPrepCompile] compilation failed for session=${sessionId}`, err);
    });
  }

  const actingCharId = characterId || session.activeCharacterId;
  const character = session.party.find(c => c.id === actingCharId) || session.party[0];
  if (!character) {
    return { ok: false, status: 400, body: { error: 'No character in session' } };
  }

  if (actionType === 'use_item' || actionType === 'give_item') {
    if (!itemId) {
      return { ok: false, status: 400, body: { error: 'Missing itemId' } };
    }

    const targetId = targetCharacterId || actingCharId;
    const { newState: itemState, actionAttempt: itemAttempt, error } = actionType === 'use_item'
      ? GameEngine.applyItemUse(session, actingCharId, itemId, targetId)
      : GameEngine.applyGiveItem(session, actingCharId, itemId, targetId);

    if (error) {
      return { ok: false, status: 400, body: { error } };
    }
    stepStart = logTurnStep(sessionId, 'item-apply', stepStart, `actionType=${actionType}`);

    const nextCharIdForItem = GameEngine.getNextActiveCharacter(itemState.party, actingCharId);
    const itemHistory = await StateService.getTurnHistory(sessionId);
    stepStart = logTurnStep(sessionId, 'item-history', stepStart, `history=${itemHistory.length}`);
    const scenePressure = buildScenePressure(itemHistory, itemAttempt, itemState.scene);
    const sceneMomentum = buildSceneMomentum(itemHistory, itemAttempt, itemState, scenePressure);
    const itemLatestChoices = itemHistory[itemHistory.length - 1]?.choices ?? itemState.lastChoices;
    const aiInput: AIInput = { ...itemState, ...itemAttempt, activeCharacterId: nextCharIdForItem, characterId: actingCharId, scenePressure, sceneMomentum, lastChoices: itemLatestChoices };
    broadcastUpdate(sessionId, 'dm_narrating', { action, statUsed, difficulty, difficultyValue, character });
    stepStart = logTurnStep(sessionId, 'item-pre-llm', stepStart);
    const itemLlmStart = Date.now();
    const turnResult = await AiDmService.generateTurnResult(aiInput);
    const itemLlmMs = Date.now() - itemLlmStart;
    stepStart = logTurnStep(sessionId, 'item-llm', stepStart, `retried=${turnResult.narrationRetried ?? false} failed=${turnResult.narrationFailed ?? false}`);

    const newState = GameEngine.updateState(itemState, itemAttempt, turnResult as unknown as Record<string, unknown>);
    await repairEncounterNameIfNeeded(itemState, newState, {
      narration: turnResult.narration,
      actionAttempt: itemAttempt.actionAttempt,
    });
    alignTurnWithResolvedEncounter(itemState, newState, turnResult);
    stripChoicesTargetingDefeatedEnemies(newState, turnResult);
    await StateService.updateSession(sessionId, newState);
    stepStart = logTurnStep(sessionId, 'item-update-session', stepStart);
    turnResult.lastAction = itemAttempt;
    turnResult.characterId = actingCharId;
    turnResult.encounterId = getTurnEncounterId(itemState, newState);
    turnResult.hpChanges = computeHpChanges(session.party, newState.party);
    turnResult.inventoryChanges = computeInventoryChanges(session.party, newState.party);
    turnResult.buffChanges = computeBuffChanges(session.party, newState.party);
    turnResult.encounterEnemyChanges = computeEncounterEnemyChanges(itemState.encounterState, newState.encounterState);
    turnResult.id = await StateService.addTurnResult(sessionId, turnResult, actingCharId);
    logTurnStep(sessionId, 'item-add-turn', stepStart, `turnId=${turnResult.id}`);
    broadcastUpdate(sessionId, 'turn_complete', { session: newState, turnResult });
    broadcastSessionChanged(namespaceId, sessionId, 'updated');
    logTurnStep(sessionId, 'item-total', turnStart, `turnId=${turnResult.id}`);
    console.log(`[Metrics] turn_complete session=${sessionId} turn=${itemState.turn} workflow=${getConfig().NARRATION_WORKFLOW} totalMs=${Date.now() - turnStart} llmMs=${itemLlmMs} retried=${turnResult.narrationRetried ?? false} failed=${turnResult.narrationFailed ?? false} choicesFailed=${turnResult.choicesFailed ?? false}`);
    return { ok: true, body: { actionAttempt: itemAttempt, turnResult, session: newState } };
  }

  if (character.status === 'downed') {
    return { ok: false, status: 400, body: { error: 'downed', message: `${character.name} is downed and cannot act.` } };
  }

  const limits = StateService.getNamespaceLimits(namespaceId ?? 'local');
  if (limits.maxTurns !== null && session.turn > limits.maxTurns) {
    return {
      ok: false,
      status: 403,
      body: { error: 'turn_limit', message: `This session has reached its limit of ${limits.maxTurns} turn(s). The adventure must end here.` },
    };
  }

  const history = await StateService.getTurnHistory(sessionId);
  stepStart = logTurnStep(sessionId, 'load-history', stepStart, `history=${history.length}`);
  const latestChoices = history[history.length - 1]?.choices ?? session.lastChoices;
  const submittedChoice = latestChoices.find(choice => choice.label === action);
  const inferredFreeActionBonuses: InferredFreeActionBonuses = submittedChoice ? {} : inferFreeActionBonuses(action, character, session);
  const helperCharacter = submittedChoice?.flavor === 'combo' && submittedChoice.helperCharacterName
    ? session.party.find(c =>
      c.name === submittedChoice.helperCharacterName &&
      c.id !== actingCharId &&
      c.status === 'active'
    )
    : inferredFreeActionBonuses.helperCharacter;
  const choiceItemOwner = submittedChoice?.flavor === 'item' && submittedChoice.itemOwnerName === character.name
    ? session.party.find(c => c.name === submittedChoice.itemOwnerName && c.status === 'active')
    : inferredFreeActionBonuses.choiceItemOwner;
  const choiceItem = choiceItemOwner && submittedChoice?.itemName
    ? choiceItemOwner.inventory.find(item => item.name === submittedChoice.itemName)
    : inferredFreeActionBonuses.choiceItem;
  const characterEdge = submittedChoice?.flavor === 'spotlight'
    ? { label: 'spotlight', bonus: CHARACTER_EDGE_BONUS }
    : submittedChoice?.flavor === 'social'
      ? { label: 'social edge', bonus: CHARACTER_EDGE_BONUS }
      : inferredFreeActionBonuses.characterEdge;
  stepStart = logTurnStep(
    sessionId,
    'prepare-action',
    stepStart,
    `choice=${submittedChoice ? 'true' : 'false'} intent=${actionIntent ?? 'none'} helper=${helperCharacter ? 'true' : 'false'} item=${choiceItem ? 'true' : 'false'}`,
  );
  const submittedChoicePreview = {
    ...(helperCharacter && {
      helperBonus: COMBO_HELPER_BONUS,
      helperCharacterName: helperCharacter.name,
    }),
    ...(choiceItem && choiceItemOwner && {
      choiceItemBonus: CHOICE_ITEM_BONUS,
      choiceItemName: choiceItem.name,
      choiceItemOwnerName: choiceItemOwner.name,
    }),
    ...(submittedChoice?.flavor === 'spotlight' && {
      characterBonus: CHARACTER_EDGE_BONUS,
      characterBonusLabel: 'spotlight',
      flavor: 'spotlight',
    }),
    ...(submittedChoice?.flavor === 'social' && {
      characterBonus: CHARACTER_EDGE_BONUS,
      characterBonusLabel: 'social edge',
      flavor: 'social',
    }),
  };
  const bonusPreview = submittedChoice ? submittedChoicePreview : toFreeActionBonusPreview(inferredFreeActionBonuses);
  broadcastUpdate(sessionId, 'dm_narrating', { action, statUsed, difficulty, difficultyValue, character, ...bonusPreview });
  const actionAttempt = resolveRiddleAnswer(action, latestChoices) ?? GameEngine.resolveAction(
    character,
    action,
    statUsed as Stat | 'none',
    (difficulty || 'normal') as Difficulty,
    difficultyValue ?? undefined,
    helperCharacter ? { name: helperCharacter.name, bonus: COMBO_HELPER_BONUS } : undefined,
    choiceItem && choiceItemOwner ? { name: choiceItem.name, ownerName: choiceItemOwner.name, bonus: CHOICE_ITEM_BONUS } : undefined,
    characterEdge,
  );
  const nextCharId = GameEngine.getNextActiveCharacter(session.party, actingCharId);
  const scenePressure = buildScenePressure(history, actionAttempt, session.scene);
  const sceneMomentum = buildSceneMomentum(history, actionAttempt, session, scenePressure);
  const effectiveActionIntent = actionIntent ?? inferActionIntent(action, session);
  const aiInput: AIInput = { ...session, ...actionAttempt, activeCharacterId: nextCharId, characterId: actingCharId, scenePressure, sceneMomentum, ...(effectiveActionIntent && { actionIntent: effectiveActionIntent }), lastChoices: latestChoices };
  const targetCharName = targetCharacterId ? session.party.find(c => c.id === targetCharacterId)?.name : undefined;
  stepStart = logTurnStep(
    sessionId,
    'build-ai-input',
    stepStart,
    `scenePressure=${scenePressure.kind} momentum=${sceneMomentum.directive}`,
  );

  const earlyHpChange = GameEngine.computeDeterministicHpChange(session, actingCharId, actionAttempt);
  if (actionAttempt.actionResult.statUsed !== 'none') {
    broadcastUpdate(sessionId, 'narration_roll_ready', {
      rollNarration: buildRollNarration(actionAttempt.actionResult) || null,
      actionResult: actionAttempt.actionResult,
      hpChanges: earlyHpChange ? [earlyHpChange] : undefined,
    });
  }
  devLog.log(`[Turn] llm-start session=${sessionId} turn=${session.turn}`);
  const llmStart = Date.now();
  const streamCallbacks: NarrationStreamCallbacks = {
    onChunk: (text, field) => broadcastUpdate(sessionId, 'narration_chunk', { text, field }),
    onStreamingDone: (narration, rollNarration) => broadcastUpdate(sessionId, 'narration_streaming_done', { narration, rollNarration }),
    onAbort: () => broadcastUpdate(sessionId, 'narration_chunk_abort', {}),
  };
  let turnResult = await AiDmService.generateTurnResult(aiInput, streamCallbacks);
  const llmMs = Date.now() - llmStart;
  stepStart = logTurnStep(sessionId, 'llm', stepStart, `retried=${turnResult.narrationRetried ?? false} failed=${turnResult.narrationFailed ?? false}`);
  devLog.log(`[Turn] llm-done session=${sessionId} retried=${turnResult.narrationRetried ?? false} failed=${turnResult.narrationFailed ?? false}`);
  turnResult = ensureSuccessfulHealingSuggestion(session, actionAttempt, turnResult);
  turnResult = ensureSuccessfulEnchantmentSuggestion(session, actionAttempt, turnResult);
  turnResult = ensureSuccessfulSupportSuggestion(session, actionAttempt, turnResult, effectiveActionIntent, targetCharName);
  stepStart = logTurnStep(sessionId, 'post-llm-guards', stepStart);
  const newState = GameEngine.updateState(session, actionAttempt, turnResult as unknown as Record<string, unknown>);
  await repairEncounterNameIfNeeded(session, newState, {
    narration: turnResult.narration,
    actionAttempt: actionAttempt.actionAttempt,
  });
  alignTurnWithResolvedEncounter(session, newState, turnResult);
  const choicesHadDefeatedRefs = stripChoicesTargetingDefeatedEnemies(newState, turnResult);
  if (choicesHadDefeatedRefs && !turnResult.choicesFailed && getConfig().NARRATION_WORKFLOW === 'agentic') {
    devLog.log(`[Guard] choices-rerun start session=${sessionId}`);
    const updatedNarrationInput = toNarrationInput({ ...aiInput, encounterState: newState.encounterState ?? undefined });
    const rerunChoices = await new DmTurnOrchestrator().rerunChoices(updatedNarrationInput);
    if (rerunChoices !== null) {
      turnResult.choices = rerunChoices;
      newState.lastChoices = rerunChoices;
      devLog.log(`[Guard] choices-rerun done session=${sessionId}`);
    }
  }
  await StateService.updateSession(sessionId, newState);
  stepStart = logTurnStep(sessionId, 'update-session', stepStart);

  turnResult.lastAction = actionAttempt;
  turnResult.characterId = actingCharId;
  turnResult.encounterId = getTurnEncounterId(session, newState);
  turnResult.hpChanges = computeHpChanges(session.party, newState.party);
  turnResult.inventoryChanges = computeInventoryChanges(session.party, newState.party);
  turnResult.buffChanges = computeBuffChanges(session.party, newState.party);
  turnResult.encounterEnemyChanges = computeEncounterEnemyChanges(session.encounterState, newState.encounterState);
  stepStart = logTurnStep(sessionId, 'compute-diffs', stepStart);

  turnResult.id = await StateService.addTurnResult(sessionId, turnResult, actingCharId);
  logTurnStep(sessionId, 'add-turn', stepStart, `turnId=${turnResult.id}`);
  devLog.log(`[Turn] broadcast session=${sessionId} turnId=${turnResult.id}`);
  broadcastUpdate(sessionId, 'turn_complete', { session: newState, turnResult });
  broadcastSessionChanged(namespaceId, sessionId, 'updated');
  logTurnStep(sessionId, 'total', turnStart, `turnId=${turnResult.id}`);
  console.log(`[Metrics] turn_complete session=${sessionId} turn=${session.turn} workflow=${getConfig().NARRATION_WORKFLOW} totalMs=${Date.now() - turnStart} llmMs=${llmMs} retried=${turnResult.narrationRetried ?? false} failed=${turnResult.narrationFailed ?? false} choicesFailed=${turnResult.choicesFailed ?? false}`);

  return {
    ok: true,
    body: { actionAttempt, turnResult, session: newState },
    queueSideEffects: () => queueCompletedTurnSideEffects({
      sessionId,
      namespaceId,
      previousSession: session,
      newState,
      turnResult,
    }),
  };
};
