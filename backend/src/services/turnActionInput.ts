import type { Choice, Difficulty, SessionState, Stat } from '../types.js';
import { lookupActionPreview, type StoredActionPreview } from './actionPreviewStore.js';
import { assessRiddleAction, ensureActiveRiddle, RIDDLE_ANSWER_UNKNOWN_MESSAGE, type RiddleActionInput } from './riddleService.js';
import { scheduleRiddleRecovery } from './riddleRecoveryService.js';
import { StateService } from './stateService.js';

// Wire format of POST /session/:id/action. Kept for compatibility: older clients send
// legacy aliases (ownerCharId, targetCharId, 'use item').
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
  previewId?: string;
  // Stable id of a suggested choice from the latest turn. The only way to select one:
  // text that happens to equal a choice label is free text.
  choiceId?: number;
}

type ActionContext = {
  actorId: string;
  targetCharacterId?: string;
  actionIntent?: string;
};

// Normalized action. Mechanics for 'choice' come from the server-stored choice
// descriptor; for a confirmed preview (any kind) from the stored preview.
export type TurnAction =
  | (ActionContext & { kind: 'choice'; text: string; choice: Choice })
  | (ActionContext & { kind: 'free_text'; text: string; statUsed: Stat | 'none'; difficulty: Difficulty; difficultyValue?: number; preview?: StoredActionPreview })
  | (ActionContext & { kind: 'item_use'; text: string; itemId: string; preview?: StoredActionPreview })
  | (ActionContext & { kind: 'item_give'; text: string; itemId: string; preview?: StoredActionPreview });

export type TurnActionRejection = {
  ok: false;
  status: number;
  body: Record<string, unknown>;
};

export const rejectTurnAction = (status: number, body: Record<string, unknown>): TurnActionRejection => ({ ok: false, status, body });

const legacyItemKind = (request: TurnActionRequest): 'item_use' | 'item_give' | null => {
  const actionType = request.actionType ?? (request.itemId && request.action === 'use item'
    ? 'use_item'
    : request.itemId && request.action === 'give item'
      ? 'give_item'
      : undefined);
  if (actionType === 'use_item') {
    return 'item_use';
  }
  if (actionType === 'give_item') {
    return 'item_give';
  }
  return null;
};

const stalePreview = (): TurnActionRejection =>
  rejectTurnAction(409, { error: 'stale_preview', message: 'The scene changed since this action was previewed. Review it again before confirming.' });

const previewMismatch = (): TurnActionRejection =>
  rejectTurnAction(409, { error: 'preview_mismatch', message: 'This action changed since it was previewed. Review it again before confirming.' });

// A confirmed preview is the action: kind, actor, target, intent and item come from the
// stored record. Request fields may repeat them but never override them.
const actionFromPreview = (
  request: TurnActionRequest,
  session: Pick<SessionState, 'id' | 'revision'>,
  previewId: string,
): TurnAction | TurnActionRejection => {
  const lookup = lookupActionPreview(previewId, session.id, session.revision ?? 0);
  if (lookup.status !== 'valid') {
    return stalePreview();
  }
  const preview = lookup.preview;
  const actorId = preview.kind === 'free_text'
    ? preview.actingCharacterId
    : preview.itemOwnerCharacterId ?? preview.actingCharacterId;
  const requestActor = request.characterId ?? request.ownerCharId;
  const requestTarget = request.targetCharacterId ?? request.targetCharId;
  const requestItemKind = legacyItemKind(request);
  const conflicts = request.choiceId !== undefined
    || (requestActor !== undefined && requestActor !== actorId)
    || (requestTarget !== undefined && requestTarget !== preview.targetCharacterId)
    || (request.actionIntent !== undefined && request.actionIntent !== preview.actionIntent)
    || (request.itemId !== undefined && request.itemId !== preview.itemId)
    || (requestItemKind !== null && requestItemKind !== preview.kind)
    || (request.action !== preview.interpretedAction && request.action !== preview.originalAction);
  if (conflicts) {
    return previewMismatch();
  }

  const context: ActionContext = {
    actorId,
    ...(preview.targetCharacterId && { targetCharacterId: preview.targetCharacterId }),
    ...(preview.actionIntent && { actionIntent: preview.actionIntent }),
  };
  if (preview.kind === 'item_use' || preview.kind === 'item_give') {
    if (!preview.itemId) {
      return previewMismatch();
    }
    return { ...context, kind: preview.kind, text: request.action, itemId: preview.itemId, preview };
  }
  return {
    ...context,
    kind: 'free_text',
    text: request.action,
    statUsed: preview.stat,
    difficulty: preview.difficulty,
    ...(preview.difficultyValue != null && { difficultyValue: preview.difficultyValue }),
    preview,
  };
};

// Boundary adapter: legacy wire body -> discriminated action. latestChoices are the
// suggestions offered by the latest committed turn (the only ones still valid).
// Precedence: a confirmed preview, then an explicit choice id, then item aliases,
// then free text.
export const normalizeTurnAction = (
  request: TurnActionRequest,
  session: Pick<SessionState, 'id' | 'revision' | 'activeCharacterId'>,
  latestChoices: Choice[],
): TurnAction | TurnActionRejection => {
  if (request.previewId) {
    return actionFromPreview(request, session, request.previewId);
  }

  const context: ActionContext = {
    actorId: request.characterId ?? request.ownerCharId ?? session.activeCharacterId,
    ...((request.targetCharacterId ?? request.targetCharId) && { targetCharacterId: request.targetCharacterId ?? request.targetCharId }),
    ...(request.actionIntent && { actionIntent: request.actionIntent }),
  };

  if (request.choiceId !== undefined) {
    const choice = latestChoices.find(c => c.id === request.choiceId);
    if (!choice) {
      // The suggestion belongs to an older turn: the story moved on.
      return rejectTurnAction(409, { error: 'stale_choice', message: 'That option is from an earlier moment in the story. Pick from the latest options.' });
    }
    return { ...context, kind: 'choice', text: choice.label, choice };
  }

  const itemKind = legacyItemKind(request);
  if (itemKind) {
    if (!request.itemId) {
      return rejectTurnAction(400, { error: 'missing_item', message: 'Missing itemId' });
    }
    return { ...context, kind: itemKind, text: request.action, itemId: request.itemId };
  }

  return {
    ...context,
    kind: 'free_text',
    text: request.action,
    statUsed: request.statUsed as Stat | 'none',
    difficulty: (request.difficulty || 'normal') as Difficulty,
    ...(request.difficultyValue != null && { difficultyValue: request.difficultyValue }),
  };
};

export const isRejection = (value: TurnAction | TurnActionRejection): value is TurnActionRejection =>
  'ok' in value && value.ok === false;

// Riddle answers are judged on the player's own words: a confirmed preview's original
// text, not the model's rewrite of it.
export const toRiddleActionInput = (action: Extract<TurnAction, { kind: 'choice' | 'free_text' }>): RiddleActionInput =>
  action.kind === 'choice'
    ? { kind: 'choice', choice: action.choice }
    : {
      kind: 'free_text',
      text: action.preview?.originalAction ?? action.text,
      ...(action.preview?.clarifications?.length && { clarifications: action.preview.clarifications }),
    };

// Cheap state checks shared by the route (before acceptance) and the worker (after the
// session is reloaded). Every action kind goes through the same access, limit,
// session-state and actor rules.
export const validateTurnAction = (
  session: SessionState,
  namespaceId: string | undefined,
  action: TurnAction,
): TurnActionRejection | null => {
  if (session.gameOver) {
    return rejectTurnAction(409, { error: 'game_over', message: 'This campaign has ended. Its chronicle is still here to read.' });
  }
  if (session.adventure && session.adventure.status !== 'active') {
    return rejectTurnAction(409, {
      error: 'adventure_completed',
      message: session.adventure.status === 'completed'
        ? 'This adventure has ended. Continue the world to start a new chapter.'
        : 'The story is reaching its ending. Wait for the final scene.',
    });
  }
  const character = session.party.find(c => c.id === action.actorId) || session.party[0];
  if (!character) {
    return rejectTurnAction(400, { error: 'no_character', message: 'No character in session' });
  }

  // Item turns count against the namespace turn limit like any other turn.
  const limits = StateService.getNamespaceLimits(namespaceId ?? 'local');
  if (limits.maxTurns !== null && session.turn > limits.maxTurns) {
    return rejectTurnAction(403, { error: 'turn_limit', message: `This session has reached its limit of ${limits.maxTurns} turn(s). The adventure must end here.` });
  }

  if (action.kind === 'item_use' || action.kind === 'item_give') {
    // A previewed item action whose item or target vanished is a retryable conflict:
    // the player keeps the draft and previews again.
    const previewed = action.preview !== undefined;
    if (!character.inventory.some(item => item.id === action.itemId)) {
      return previewed
        ? rejectTurnAction(409, { error: 'item_unavailable', message: 'That item is no longer in this hero\'s pack. Review the action again.' })
        : rejectTurnAction(400, { error: 'item_not_found', message: 'That item is no longer in this hero\'s pack.' });
    }
    if (action.kind === 'item_give' && !session.party.some(c => c.id === (action.targetCharacterId || action.actorId))) {
      return previewed
        ? rejectTurnAction(409, { error: 'item_unavailable', message: 'That hero is no longer in the party. Review the action again.' })
        : rejectTurnAction(400, { error: 'target_not_found', message: 'That hero is no longer in the party.' });
    }
    return null;
  }

  if (character.status === 'downed') {
    return rejectTurnAction(400, { error: 'downed', message: `${character.name} is downed and cannot act.` });
  }

  // While a riddle is open, an answer attempt never falls through to a stat roll:
  // anything the server cannot judge is sent back with the draft kept.
  const activeRiddle = ensureActiveRiddle(session);
  const riddle = assessRiddleAction(toRiddleActionInput(action), activeRiddle);
  if (riddle.type === 'unclear') {
    return rejectTurnAction(409, { error: 'riddle_unclear', message: riddle.question });
  }
  if (riddle.type === 'answer_unknown') {
    // Recovery either finds the answer or closes the riddle with a DM beat.
    scheduleRiddleRecovery(session.id, namespaceId ?? 'local', activeRiddle);
    return rejectTurnAction(409, { error: 'riddle_answer_unknown', message: RIDDLE_ANSWER_UNKNOWN_MESSAGE });
  }

  return null;
};

// Route helper: normalize against the session's current suggestions and validate.
export const validateTurnActionRequest = (
  session: SessionState,
  namespaceId: string | undefined,
  request: TurnActionRequest,
): TurnActionRejection | null => {
  const action = normalizeTurnAction(request, session, session.lastChoices);
  if (isRejection(action)) {
    return action;
  }
  return validateTurnAction(session, namespaceId, action);
};
