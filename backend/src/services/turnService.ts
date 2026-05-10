import { broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import type { ActionAttempt, AIInput, Difficulty, SessionState, Stat } from '../types.js';
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
import { buildSceneMomentum, buildScenePressure } from './sceneMomentumService.js';

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
    const scenePressure = buildScenePressure(itemHistory, itemAttempt, itemState.scene);
    const sceneMomentum = buildSceneMomentum(itemHistory, itemAttempt, itemState, scenePressure);
    const aiInput: AIInput = { ...itemState, ...itemAttempt, activeCharacterId: nextCharIdForItem, characterId: actingCharId, scenePressure, sceneMomentum };
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
  const scenePressure = buildScenePressure(history, actionAttempt, session.scene);
  const sceneMomentum = buildSceneMomentum(history, actionAttempt, session, scenePressure);
  const aiInput: AIInput = { ...session, ...actionAttempt, activeCharacterId: nextCharId, characterId: actingCharId, scenePressure, sceneMomentum };

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
