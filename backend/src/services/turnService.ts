import { broadcastUpdate } from '../realtime/sessionEvents.js';
import { devLog } from '../lib/devLog.js';
import type { ActionAttempt, AIInput, Choice, NarratedRiddle, ServerTurnResult, SessionState, Stat, TurnResult } from '../types.js';
import { AiDmService } from './aiDmService.js';
import type { NarrationStreamCallbacks } from '../providers/ai/narration/NarrationProvider.js';
import { GameEngine } from './gameEngine.js';
import { StateService } from './stateService.js';
import { compileDmPrepPremise } from './dmPrepCompilationService.js';
import { assessRiddleAction, ensureActiveRiddle, syncRiddleChoices, toRiddleAttempt } from './riddleService.js';
import { extractRiddleAnswer } from './riddleRepairService.js';
import { riddleRepository } from '../repositories/riddleRepository.js';
import {
  CHARACTER_EDGE_BONUS,
  CHOICE_ITEM_BONUS,
  COMBO_HELPER_BONUS,
  type InferredFreeActionBonuses,
  inferFreeActionBonuses,
  toFreeActionBonusPreview,
} from './freeActionInferenceService.js';
import { buildSceneMomentum, buildScenePressure } from './sceneMomentumService.js';
import { inferActionIntent, isNoFailureDamageAction } from './freeActionPolicyService.js';
import { getTurnStrategy } from '../config/env.js';
import { applyTurnPolicies, createTurnDiagnostics, type TurnDiagnostics } from './turnDiagnostics.js';
import { generateResolvedFirstTurn } from './resolvedFirstTurnService.js';
import { repairEncounterNameIfNeeded } from './encounterNameRepairService.js';
import { checkTurnResultConsistency } from './turnResultConsistencyService.js';
import { buildRollNarration } from './rollNarrationService.js';
import { buildAdventureDirective } from './adventureLifecycleService.js';
import { isRejection, normalizeTurnAction, rejectTurnAction, toRiddleActionInput, validateTurnAction, type TurnAction, type TurnActionRequest } from './turnActionInput.js';
import { finalizeTurn, type TurnActionResult } from './turnFinalizer.js';
import { alignTurnWithResolvedEncounter, stripChoicesTargetingDefeatedEnemies } from './turnRepairs.js';

// Stable entry points for routes and tests.
export type { TurnActionRequest, TurnActionRejection } from './turnActionInput.js';
export { validateTurnActionRequest } from './turnActionInput.js';
export type { TurnActionResult } from './turnFinalizer.js';

export type TurnActionOptions = {
  operationId?: string;
};

const logTurnStep = (sessionId: string, step: string, start: number, details = ''): number => {
  const now = Date.now();
  devLog.log(`[Turn] step session=${sessionId} ${step} durationMs=${now - start}${details ? ` ${details}` : ''}`);
  return now;
};

const compileDmPrepIfMissing = (sessionId: string, session: SessionState): void => {
  if (!session.dmPrep || session.compiledDmPrep) {
    return;
  }
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
};

type ResolutionContext = {
  sessionId: string;
  namespaceId: string | undefined;
  operationId?: string;
  session: SessionState;
  history: TurnResult[];
  latestChoices: Choice[];
  turnStart: number;
  stepStart: number;
};

// Item use/give: deterministic effect first, then narration of it. Item turns advance
// the turn and rotate the actor like any other turn (see GAME_ENGINE_RULES.md).
const resolveItemTurn = async (
  ctx: ResolutionContext,
  action: Extract<TurnAction, { kind: 'item_use' | 'item_give' }>,
): Promise<TurnActionResult> => {
  const { sessionId, session, history, operationId } = ctx;
  let stepStart = ctx.stepStart;
  const diagnostics = createTurnDiagnostics(getTurnStrategy());
  const actingCharId = action.actorId;
  const character = session.party.find(c => c.id === actingCharId) || session.party[0];
  const targetId = action.targetCharacterId || actingCharId;
  const { newState: itemState, actionAttempt: itemAttempt, error } = action.kind === 'item_use'
    ? GameEngine.applyItemUse(session, actingCharId, action.itemId, targetId)
    : GameEngine.applyGiveItem(session, actingCharId, action.itemId, targetId);
  if (error) {
    return rejectTurnAction(400, { error: 'item_action_failed', message: error });
  }
  stepStart = logTurnStep(sessionId, 'item-apply', stepStart, `kind=${action.kind}`);

  const nextCharIdForItem = GameEngine.getNextActiveCharacter(itemState.party, actingCharId);
  const scenePressure = buildScenePressure(history, itemAttempt, itemState.scene);
  const sceneMomentum = buildSceneMomentum(history, itemAttempt, itemState, scenePressure);
  const itemDirective = buildAdventureDirective(session);
  const aiInput: AIInput = { ...itemState, ...itemAttempt, activeCharacterId: nextCharIdForItem, characterId: actingCharId, scenePressure, sceneMomentum, lastChoices: ctx.latestChoices, ...(itemDirective && { adventureDirective: itemDirective }) };
  broadcastUpdate(sessionId, 'dm_narrating', { action: action.text, statUsed: 'none', character, operationId });
  stepStart = logTurnStep(sessionId, 'item-pre-llm', stepStart);
  const itemLlmStart = Date.now();

  // The item's effect is already applied (itemState). resolved_first then settles the
  // mechanics agents' proposals and narrates from facts measured against the session
  // before the item, so the story tells both the item and what followed.
  const resolvedFirst = diagnostics.record.strategy === 'resolved_first'
    ? await generateResolvedFirstTurn({
      session: itemState,
      aiInput,
      actionAttempt: itemAttempt,
      actingCharId,
      actionIntent: undefined,
      targetCharName: undefined,
      diagnostics,
      factsBaseline: session,
      itemTurn: true,
    })
    : null;
  if (diagnostics.record.strategy === 'resolved_first' && !resolvedFirst) {
    diagnostics.record.strategy = 'parallel';
  }

  let turnResult: ServerTurnResult;
  let newState: SessionState;
  if (resolvedFirst) {
    ({ turnResult, newState } = resolvedFirst);
    logTurnStep(sessionId, 'item-resolved-first', stepStart, `failed=${turnResult.narrationFailed ?? false}`);
  } else {
    turnResult = await AiDmService.generateTurnResult(aiInput);
    logTurnStep(sessionId, 'item-llm', stepStart, `retried=${turnResult.narrationRetried ?? false} failed=${turnResult.narrationFailed ?? false}`);
    diagnostics.stage('generation', itemLlmStart);
    checkTurnResultConsistency(turnResult, itemState, itemAttempt);
    newState = GameEngine.applyTurnProposal(itemState, itemAttempt, turnResult);
    await repairEncounterNameIfNeeded(itemState, newState, {
      narration: turnResult.narration,
      actionAttempt: itemAttempt.actionAttempt,
    });
    const itemNarrationBeforeAlign = turnResult.narration;
    alignTurnWithResolvedEncounter(itemState, newState, turnResult);
    if (turnResult.narration !== itemNarrationBeforeAlign) {
      diagnostics.repair('align_resolved_encounter_narration');
    }
    if (stripChoicesTargetingDefeatedEnemies(newState, turnResult)) {
      diagnostics.repair('strip_defeated_enemy_choices');
    }
  }
  const itemLlmMs = Date.now() - itemLlmStart;
  // Diffs are computed against the pre-item session so the item's own effect is reported.
  return finalizeTurn({
    sessionId,
    namespaceId: ctx.namespaceId,
    operationId,
    previousSession: session,
    newState,
    turnResult,
    actingCharId,
    actionAttempt: itemAttempt,
    turnStart: ctx.turnStart,
    llmMs: itemLlmMs,
    stepLabel: 'item-',
    diagnostics,
  });
};

// A riddle posed by narration without a usable answer gets one bounded extraction
// call before the commit. If that fails too, the riddle is recorded as answer unknown.
const completeNarratedRiddle = async (turnResult: ServerTurnResult, diagnostics: TurnDiagnostics): Promise<NarratedRiddle | null> => {
  const narrated = turnResult.narrationFailed ? null : turnResult.narratedRiddle ?? null;
  if (!narrated || narrated.canonicalAnswer) {
    return narrated;
  }
  const extracted = await extractRiddleAnswer(turnResult.narration, narrated.prompt);
  diagnostics.repair(extracted ? 'riddle_answer_extracted' : 'riddle_answer_unknown');
  return extracted ? { ...narrated, ...extracted } : narrated;
};

// Suggested choices and free text: roll, generate, repair.
const resolveRolledTurn = async (
  ctx: ResolutionContext,
  action: Extract<TurnAction, { kind: 'choice' | 'free_text' }>,
): Promise<TurnActionResult> => {
  const { sessionId, session, history, latestChoices, operationId } = ctx;
  let stepStart = ctx.stepStart;
  const diagnostics = createTurnDiagnostics(getTurnStrategy());
  const actionText = action.text;
  const actingCharId = action.actorId;
  const character = session.party.find(c => c.id === actingCharId) || session.party[0];
  const submittedChoice = action.kind === 'choice' ? action.choice : undefined;
  const recentChoiceLabels = [...new Set(
    history.slice(-5, -1).flatMap(h => h.choices.map(c => c.label))
  )];

  // Mechanics come from server-owned records: the stored choice descriptor for a
  // suggested action, or the stored preview for a confirmed free action. Client
  // echoes are a fallback for unpreviewed free text only.
  // normalizeTurnAction already copied a confirmed preview's mechanics onto the action.
  const { statUsed, difficulty, difficultyValue } = action.kind === 'choice'
    ? { statUsed: action.choice.stat as Stat | 'none', difficulty: action.choice.difficulty, difficultyValue: action.choice.difficultyValue }
    : { statUsed: action.statUsed, difficulty: action.difficulty, difficultyValue: action.difficultyValue };

  const inferredFreeActionBonuses: InferredFreeActionBonuses = submittedChoice ? {} : inferFreeActionBonuses(actionText, character, session);
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
    `kind=${action.kind} preview=${action.kind === 'free_text' && action.preview ? 'valid' : 'none'} intent=${action.actionIntent ?? 'none'} helper=${helperCharacter ? 'true' : 'false'} item=${choiceItem ? 'true' : 'false'}`,
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
  broadcastUpdate(sessionId, 'dm_narrating', { action: actionText, statUsed, difficulty, difficultyValue, character, operationId, ...bonusPreview });
  // validateTurnAction already rejected unclear answers; here an answer resolves without a roll.
  const activeRiddle = ensureActiveRiddle({ id: sessionId, turn: session.turn, lastChoices: latestChoices });
  const riddleAssessment = assessRiddleAction(toRiddleActionInput(action), activeRiddle);
  const solvedRiddleId = riddleAssessment.type === 'answer' && riddleAssessment.correct ? riddleAssessment.riddleId : undefined;
  const actionAttempt: ActionAttempt = riddleAssessment.type === 'answer' ? toRiddleAttempt(actionText, riddleAssessment.correct) : GameEngine.resolveAction(
    character,
    actionText,
    statUsed,
    difficulty,
    difficultyValue,
    helperCharacter ? { name: helperCharacter.name, bonus: COMBO_HELPER_BONUS } : undefined,
    choiceItem && choiceItemOwner ? { name: choiceItem.name, ownerName: choiceItemOwner.name, bonus: CHOICE_ITEM_BONUS } : undefined,
    characterEdge,
  );
  const nextCharId = GameEngine.getNextActiveCharacter(session.party, actingCharId);
  const scenePressure = buildScenePressure(history, actionAttempt, session.scene);
  const sceneMomentum = buildSceneMomentum(history, actionAttempt, session, scenePressure);
  const effectiveActionIntent = action.actionIntent ?? inferActionIntent(actionText, session);
  const adventureDirective = buildAdventureDirective(session);
  const aiInput: AIInput = { ...(adventureDirective && { adventureDirective }), ...session, ...actionAttempt, activeCharacterId: nextCharId, characterId: actingCharId, scenePressure, sceneMomentum, ...(effectiveActionIntent && { actionIntent: effectiveActionIntent }), lastChoices: latestChoices, ...(recentChoiceLabels.length > 0 && { recentChoiceLabels }) };
  const targetCharName = action.targetCharacterId ? session.party.find(c => c.id === action.targetCharacterId)?.name : undefined;
  stepStart = logTurnStep(
    sessionId,
    'build-ai-input',
    stepStart,
    `scenePressure=${scenePressure.kind} momentum=${sceneMomentum.directive}`,
  );

  const earlyHpChange = isNoFailureDamageAction(actionText, effectiveActionIntent)
    ? null
    : GameEngine.computeDeterministicHpChange(session, actingCharId, actionAttempt);
  if (actionAttempt.actionResult.statUsed !== 'none') {
    broadcastUpdate(sessionId, 'narration_roll_ready', {
      rollNarration: buildRollNarration(actionAttempt.actionResult) || null,
      actionResult: actionAttempt.actionResult,
      hpChanges: earlyHpChange ? [earlyHpChange] : undefined,
      operationId,
    });
  }
  devLog.log(`[Turn] llm-start session=${sessionId} turn=${session.turn}`);
  const llmStart = Date.now();
  const streamCallbacks: NarrationStreamCallbacks = {
    onChunk: (text, field) => {
      if (field === 'narration' && diagnostics.record.firstNarrationMs === undefined) {
        diagnostics.record.firstNarrationMs = Date.now() - ctx.turnStart;
      }
      broadcastUpdate(sessionId, 'narration_chunk', { text, field, operationId });
    },
    onStreamingDone: (narration, rollNarration) => broadcastUpdate(sessionId, 'narration_streaming_done', { narration, rollNarration, operationId }),
    onAbort: () => broadcastUpdate(sessionId, 'narration_chunk_abort', { operationId }),
  };

  // resolved_first (default) freezes mechanics before narration; parallel is the opt-out
  // comparator. Both share policies and the finalizer.
  const resolvedFirst = diagnostics.record.strategy === 'resolved_first'
    ? await generateResolvedFirstTurn({
      session,
      aiInput,
      actionAttempt,
      actingCharId,
      actionIntent: effectiveActionIntent,
      targetCharName,
      streamCallbacks,
      diagnostics,
    })
    : null;
  if (diagnostics.record.strategy === 'resolved_first' && !resolvedFirst) {
    diagnostics.record.strategy = 'parallel';
  }

  let turnResult: ServerTurnResult;
  let newState: SessionState;
  if (resolvedFirst) {
    ({ turnResult, newState } = resolvedFirst);
    stepStart = logTurnStep(sessionId, 'resolved-first', stepStart, `failed=${turnResult.narrationFailed ?? false}`);
  } else {
    turnResult = await AiDmService.generateTurnResult(aiInput, streamCallbacks);
    stepStart = logTurnStep(sessionId, 'llm', stepStart, `retried=${turnResult.narrationRetried ?? false} failed=${turnResult.narrationFailed ?? false}`);
    diagnostics.stage('generation', llmStart);
    devLog.log(`[Turn] llm-done session=${sessionId} retried=${turnResult.narrationRetried ?? false} failed=${turnResult.narrationFailed ?? false}`);
    turnResult = applyTurnPolicies(session, actionAttempt, turnResult, effectiveActionIntent, targetCharName, diagnostics);
    checkTurnResultConsistency(turnResult, session, actionAttempt);
    stepStart = logTurnStep(sessionId, 'post-llm-guards', stepStart);
    newState = GameEngine.applyTurnProposal(session, actionAttempt, turnResult);
    await repairEncounterNameIfNeeded(session, newState, {
      narration: turnResult.narration,
      actionAttempt: actionAttempt.actionAttempt,
    });
    const narrationBeforeAlign = turnResult.narration;
    alignTurnWithResolvedEncounter(session, newState, turnResult);
    if (turnResult.narration !== narrationBeforeAlign) {
      diagnostics.repair('align_resolved_encounter_narration');
    }
    if (stripChoicesTargetingDefeatedEnemies(newState, turnResult)) {
      diagnostics.repair('strip_defeated_enemy_choices');
    }
  }
  // Riddles: the narration that posed one owns its answer. Answer choices are rebuilt
  // to match whichever riddle is open after this turn, or turned into plain actions.
  const narratedRiddle = await completeNarratedRiddle(turnResult, diagnostics);
  const openRiddle = narratedRiddle ?? (activeRiddle && activeRiddle.id !== solvedRiddleId ? activeRiddle : null);
  turnResult.choices = syncRiddleChoices(
    turnResult.choices,
    !openRiddle ? null : openRiddle.canonicalAnswer ? { canonicalAnswer: openRiddle.canonicalAnswer, aliases: openRiddle.aliases } : 'unknown',
    // Offer an answer only on the turn that posed the riddle.
    { addIfMissing: !!narratedRiddle },
  );
  newState.lastChoices = turnResult.choices;

  const llmMs = Date.now() - llmStart;
  logTurnStep(sessionId, 'guards', stepStart);

  return finalizeTurn({
    sessionId,
    namespaceId: ctx.namespaceId,
    operationId,
    previousSession: session,
    newState,
    turnResult,
    actingCharId,
    actionAttempt,
    turnStart: ctx.turnStart,
    llmMs,
    stepLabel: '',
    diagnostics,
    // Riddle state moves atomically with the turn: a correct answer closes the open
    // riddle, and a riddle posed by this turn's narration becomes the active one.
    additionalWrites: (_revision, turnId) => {
      if (solvedRiddleId) {
        riddleRepository.setStatus(solvedRiddleId, 'solved');
      }
      if (narratedRiddle) {
        riddleRepository.activate({
          sessionId,
          sourceTurnId: turnId,
          sourceTurnNumber: newState.turn,
          ...(narratedRiddle.prompt && { prompt: narratedRiddle.prompt }),
          ...(narratedRiddle.canonicalAnswer && { canonicalAnswer: narratedRiddle.canonicalAnswer }),
          aliases: narratedRiddle.aliases,
          wrongAnswers: turnResult.choices.filter(choice => choice.riddleCorrect === false).map(choice => choice.riddleAnswer as string),
          answerKnown: !!narratedRiddle.canonicalAnswer,
          source: 'narration',
        });
      }
    },
  });
};

export const executeTurnAction = async (
  sessionId: string,
  namespaceId: string | undefined,
  request: TurnActionRequest,
  options: TurnActionOptions = {},
): Promise<TurnActionResult> => {
  const turnStart = Date.now();
  let stepStart = turnStart;

  const sessionNamespace = StateService.getSessionNamespaceId(sessionId);
  if (!sessionNamespace || sessionNamespace !== (namespaceId ?? 'local')) {
    logTurnStep(sessionId, 'namespace-miss', stepStart);
    return rejectTurnAction(404, { error: 'Session not found' });
  }
  const session = await StateService.getSession(sessionId);
  stepStart = logTurnStep(sessionId, 'load-session', stepStart);
  if (!session) {
    return rejectTurnAction(404, { error: 'Session not found' });
  }
  const history = await StateService.getTurnHistory(sessionId);
  stepStart = logTurnStep(sessionId, 'load-history', stepStart, `history=${history.length}`);
  // Only current ideas: session.lastChoices is empty once they went stale.
  const latestChoices = session.lastChoices;

  const action = normalizeTurnAction(request, session, latestChoices);
  if (isRejection(action)) {
    return action;
  }
  const rejection = validateTurnAction(session, namespaceId, action);
  if (rejection) {
    return rejection;
  }

  compileDmPrepIfMissing(sessionId, session);

  const ctx: ResolutionContext = {
    sessionId,
    namespaceId,
    operationId: options.operationId,
    session,
    history,
    latestChoices,
    turnStart,
    stepStart,
  };
  return action.kind === 'item_use' || action.kind === 'item_give'
    ? resolveItemTurn(ctx, action)
    : resolveRolledTurn(ctx, action);
};
