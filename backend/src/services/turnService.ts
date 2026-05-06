import { broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import type { ActionAttempt, AIInput, Character, Difficulty, InventoryItem, SessionState, Stat } from '../types.js';
import { AiDmService } from './aiDmService.js';
import { GameEngine } from './gameEngine.js';
import { StateService } from './stateService.js';
import { queueCompletedTurnSideEffects } from './turnSideEffectService.js';
import { computeHpChanges, computeInventoryChanges } from './turnChangeService.js';
import { resolveRiddleAnswer } from './riddleService.js';

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

const COMBO_HELPER_BONUS = 2;
const CHOICE_ITEM_BONUS = 2;
const CHARACTER_EDGE_BONUS = 2;
const FREE_ACTION_MAX_INFERRED_BONUSES = 2;
const SOCIAL_ACTION_RE = /\b(charm|convince|persuade|deceive|trick|lie|bluff|negotiate|bargain|barter|haggle|intimidate|threaten|appeal|plead|comfort|reassure|taunt|distract|perform|sing|talk|speak|ask|question|interrogate|befriend)\b/i;
const SPOTLIGHT_ACTION_RE = /\b(signature|instinct|training|heritage|background|memory|quirk|talent|specialty|speciality|faith|divine|holy|sneak|stealth|shadow|arcane|spell|rage|brute|protect|shield)\b/i;

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

const searchable = (text: string | undefined): string => (text ?? '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const containsSearchable = (haystack: string, needle: string | undefined): boolean => {
  const normalizedNeedle = searchable(needle);
  return normalizedNeedle.length > 1 && haystack.includes(normalizedNeedle);
};

const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;

const actionReferencesCharacter = (normalizedAction: string, character: Character): boolean =>
  containsSearchable(normalizedAction, character.name) ||
  containsSearchable(normalizedAction, firstName(character.name));

const actionReferencesItem = (normalizedAction: string, item: InventoryItem): boolean =>
  containsSearchable(normalizedAction, item.name) ||
  item.name.split(/\s+/).some(part => containsSearchable(normalizedAction, part));

const actionUsesCharacterSpotlight = (normalizedAction: string, character: Character): boolean => {
  const classOrSpecies = containsSearchable(normalizedAction, character.class) ||
    containsSearchable(normalizedAction, character.species);
  const quirkWords = searchable(character.quirk)
    .split(' ')
    .filter(word => word.length >= 5);
  const historyWords = searchable(character.history)
    .split(' ')
    .filter(word => word.length >= 6);
  const personalWords = [...quirkWords, ...historyWords].some(word => normalizedAction.includes(word));
  return classOrSpecies || personalWords || SPOTLIGHT_ACTION_RE.test(normalizedAction);
};

type InferredFreeActionBonuses = {
  helperCharacter?: Character;
  choiceItemOwner?: Character;
  choiceItem?: InventoryItem;
  characterEdge?: { label: string; bonus: number };
};

export const inferFreeActionBonuses = (
  action: string,
  character: Character,
  session: SessionState,
): InferredFreeActionBonuses => {
  const normalizedAction = searchable(action);
  let inferredCount = 0;
  const result: InferredFreeActionBonuses = {};

  const helperCharacter = session.party.find(c =>
    c.id !== character.id &&
    c.status === 'active' &&
    actionReferencesCharacter(normalizedAction, c)
  );
  if (helperCharacter) {
    result.helperCharacter = helperCharacter;
    inferredCount++;
  }

  const itemMatch = session.party
    .filter(c => c.status === 'active')
    .flatMap(owner => owner.inventory.map(item => ({ owner, item })))
    .find(({ item }) => actionReferencesItem(normalizedAction, item));
  if (itemMatch && inferredCount < FREE_ACTION_MAX_INFERRED_BONUSES) {
    result.choiceItemOwner = itemMatch.owner;
    result.choiceItem = itemMatch.item;
    inferredCount++;
  }

  if (inferredCount < FREE_ACTION_MAX_INFERRED_BONUSES) {
    if (SOCIAL_ACTION_RE.test(normalizedAction)) {
      result.characterEdge = { label: 'social edge', bonus: CHARACTER_EDGE_BONUS };
    } else if (actionUsesCharacterSpotlight(normalizedAction, character)) {
      result.characterEdge = { label: 'spotlight', bonus: CHARACTER_EDGE_BONUS };
    }
  }

  return result;
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

  broadcastUpdate(sessionId, 'dm_narrating', { action, statUsed, difficulty, difficultyValue, character });

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
    const aiInput: AIInput = { ...itemState, ...itemAttempt, activeCharacterId: nextCharIdForItem, characterId: actingCharId };
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
  const aiInput: AIInput = { ...session, ...actionAttempt, activeCharacterId: nextCharId, characterId: actingCharId };

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
