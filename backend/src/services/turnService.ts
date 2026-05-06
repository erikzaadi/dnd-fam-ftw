import { broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import type { ActionAttempt, AIInput, Difficulty, SessionState, Stat, TurnResult } from '../types.js';
import { AiDmService } from './aiDmService.js';
import { GameEngine } from './gameEngine.js';
import { StateService } from './stateService.js';
import { queueCompletedTurnSideEffects } from './turnSideEffectService.js';
import { computeHpChanges, computeInventoryChanges } from './turnChangeService.js';
import { resolveRiddleAnswer } from './riddleService.js';
import {
  CHARACTER_EDGE_BONUS,
  CHOICE_ITEM_BONUS,
  COMBO_HELPER_BONUS,
  type InferredFreeActionBonuses,
  inferFreeActionBonuses,
  toFreeActionBonusPreview,
} from './freeActionInferenceService.js';

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
}

const PRESSURE_RE = /\b(ambush|battle|boss|brawl|challenge|chase|combat|conflict|defeat|disarm|duel|enemy|escape|fight|foe|guard|guardian|hazard|monster|obstacle|puzzle|riddle|ritual|shadow|shadows|sneak|spectral|strike|trap|wolf|wolves)\b/i;
const COMBAT_RE = /\b(ambush|attack|battle|boss|brawl|combat|duel|enemy|fight|foe|monster|strike|wolf|wolves)\b/i;
const HEALING_RE = /\b(heal|healing|restore|restoring|revive|reviving|mend|mending|soothe|soothing|recover|recovery|rest|resting|sleep|sleeping|eat|eating|meal|care|treat|treating|medicine|potion|bandage|sanctuary)\b/i;

type ScenePressure = NonNullable<AIInput['scenePressure']>;

function turnPressureKind(turn: TurnResult): ScenePressure['kind'] {
  const text = [
    turn.narration,
    turn.lastAction?.actionAttempt,
    turn.rollNarration,
    ...(turn.choices ?? []).map(choice => `${choice.label} ${choice.narration ?? ''}`),
  ].join(' ');

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

function buildScenePressure(
  history: TurnResult[],
  currentAction: ActionAttempt,
  currentScene: string,
): ScenePressure {
  const recent = history.slice(-4);
  const previousTensionLevels = recent
    .map(turn => turn.currentTensionLevel)
    .filter((level): level is ScenePressure['previousTensionLevels'][number] => !!level);
  const recentKinds = recent.map(turnPressureKind);
  const currentText = `${currentAction.actionAttempt} ${currentScene}`;
  const currentKind: ScenePressure['kind'] = COMBAT_RE.test(currentText)
    ? 'combat'
    : PRESSURE_RE.test(currentText)
      ? 'challenge'
      : 'unknown';
  const kind: ScenePressure['kind'] = currentKind !== 'unknown'
    ? currentKind
    : recentKinds.find(k => k === 'combat') ?? recentKinds.find(k => k === 'challenge') ?? recentKinds.at(-1) ?? 'unknown';
  const pressureTurns = [...recentKinds, currentKind].filter(k => k === 'combat' || k === 'challenge').length;
  const successfulPressureTurns = recent.filter(turn => {
    const lastAction = turn.lastAction;
    return !!lastAction?.actionResult.success && (turnPressureKind(turn) === 'combat' || turnPressureKind(turn) === 'challenge');
  }).length + (currentAction.actionResult.success && (currentKind === 'combat' || currentKind === 'challenge') ? 1 : 0);
  const impact = currentAction.actionResult.impact;
  const strongCurrentSuccess = currentAction.actionResult.success && (impact === 'strong' || impact === 'extreme');
  const difficultCurrentSuccess = currentAction.actionResult.success && (currentAction.actionResult.difficultyTarget ?? 0) >= 13;
  const portalEligibleThisTurn = !HEALING_RE.test(currentAction.actionAttempt) && (
    (pressureTurns >= 2 && (strongCurrentSuccess || difficultCurrentSuccess)) ||
    (pressureTurns >= 1 && impact === 'extreme')
  );

  return {
    kind,
    pressureTurns,
    successfulPressureTurns,
    previousTensionLevels,
    portalEligibleThisTurn,
    reason: portalEligibleThisTurn
      ? 'Current turn earned a fast transition after sustained pressure.'
      : 'Portal transition not earned by current turn pressure.',
  };
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
  const {
    action,
    statUsed,
    difficulty,
    difficultyValue,
    itemId,
  } = request;
  const characterId = request.characterId ?? request.ownerCharId;
  const targetCharacterId = request.targetCharacterId ?? request.targetCharId;
  const actionType = request.actionType ?? (itemId && action === 'use item'
    ? 'use_item'
    : itemId && action === 'give item'
      ? 'give_item'
      : undefined);

  const session = await StateService.getSession(sessionId);
  if (!session) {
    return { ok: false, status: 404, body: { error: 'Session not found' } };
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

    const nextCharIdForItem = GameEngine.getNextActiveCharacter(itemState.party, actingCharId);
    const itemHistory = await StateService.getTurnHistory(sessionId);
    const aiInput: AIInput = { ...itemState, ...itemAttempt, activeCharacterId: nextCharIdForItem, characterId: actingCharId, scenePressure: buildScenePressure(itemHistory, itemAttempt, itemState.scene) };
    broadcastUpdate(sessionId, 'dm_narrating', { action, statUsed, difficulty, difficultyValue, character });
    const turnResult = await AiDmService.generateTurnResult(aiInput, session.useLocalAI);

    const newState = GameEngine.updateState(itemState, itemAttempt, turnResult as unknown as Record<string, unknown>);
    await StateService.updateSession(sessionId, newState);
    turnResult.lastAction = itemAttempt;
    turnResult.characterId = actingCharId;
    turnResult.hpChanges = computeHpChanges(session.party, newState.party);
    turnResult.inventoryChanges = computeInventoryChanges(session.party, newState.party);
    turnResult.id = await StateService.addTurnResult(sessionId, turnResult, actingCharId);
    broadcastUpdate(sessionId, 'turn_complete', { session: newState, turnResult });
    broadcastSessionChanged(namespaceId, sessionId, 'updated');
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
  const choiceItemOwner = submittedChoice?.flavor === 'item' && submittedChoice.itemOwnerName
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
  const aiInput: AIInput = { ...session, ...actionAttempt, activeCharacterId: nextCharId, characterId: actingCharId, scenePressure: buildScenePressure(history, actionAttempt, session.scene) };

  const turnResult = await AiDmService.generateTurnResult(aiInput, session.useLocalAI);
  const newState = GameEngine.updateState(session, actionAttempt, turnResult as unknown as Record<string, unknown>);
  await StateService.updateSession(sessionId, newState);

  turnResult.lastAction = actionAttempt;
  turnResult.characterId = actingCharId;
  turnResult.hpChanges = computeHpChanges(session.party, newState.party);
  turnResult.inventoryChanges = computeInventoryChanges(session.party, newState.party);

  turnResult.id = await StateService.addTurnResult(sessionId, turnResult, actingCharId);
  broadcastUpdate(sessionId, 'turn_complete', { session: newState, turnResult });
  broadcastSessionChanged(namespaceId, sessionId, 'updated');

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
