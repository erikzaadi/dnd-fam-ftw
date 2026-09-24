import type { Choice, Difficulty, SessionState, Stat } from '../types.js';
import { lookupActionPreview } from './actionPreviewStore.js';
import { StateService } from './stateService.js';

// Wire format of POST /session/:id/action. Kept for compatibility: older clients send
// label-only choices and legacy aliases (ownerCharId, targetCharId, 'use item').
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
  // Stable id of a suggested choice from the latest turn. Preferred over label matching.
  choiceId?: number;
}

type ActionContext = {
  actorId: string;
  targetCharacterId?: string;
  actionIntent?: string;
};

// Normalized action. Mechanics for 'choice' come from the server-stored choice
// descriptor; for 'free_text' from the stored preview when one was confirmed.
export type TurnAction =
  | (ActionContext & { kind: 'choice'; text: string; choice: Choice })
  | (ActionContext & { kind: 'free_text'; text: string; statUsed: Stat | 'none'; difficulty: Difficulty; difficultyValue?: number; previewId?: string })
  | (ActionContext & { kind: 'item_use'; text: string; itemId: string })
  | (ActionContext & { kind: 'item_give'; text: string; itemId: string });

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

// Boundary adapter: legacy wire body -> discriminated action. latestChoices are the
// suggestions offered by the latest committed turn (the only ones still valid).
export const normalizeTurnAction = (
  request: TurnActionRequest,
  session: Pick<SessionState, 'activeCharacterId'>,
  latestChoices: Choice[],
): TurnAction | TurnActionRejection => {
  const context: ActionContext = {
    actorId: request.characterId ?? request.ownerCharId ?? session.activeCharacterId,
    ...((request.targetCharacterId ?? request.targetCharId) && { targetCharacterId: request.targetCharacterId ?? request.targetCharId }),
    ...(request.actionIntent && { actionIntent: request.actionIntent }),
  };

  const itemKind = legacyItemKind(request);
  if (itemKind) {
    if (!request.itemId) {
      return rejectTurnAction(400, { error: 'missing_item', message: 'Missing itemId' });
    }
    return { ...context, kind: itemKind, text: request.action, itemId: request.itemId };
  }

  if (request.choiceId !== undefined) {
    const choice = latestChoices.find(c => c.id === request.choiceId);
    if (!choice) {
      // The suggestion belongs to an older turn: the story moved on.
      return rejectTurnAction(409, { error: 'stale_choice', message: 'That option is from an earlier moment in the story. Pick from the latest options.' });
    }
    return { ...context, kind: 'choice', text: choice.label, choice };
  }

  // Legacy clients: a label that matches a current suggestion is that suggestion.
  const labelMatch = latestChoices.find(c => c.label === request.action);
  if (labelMatch) {
    return { ...context, kind: 'choice', text: labelMatch.label, choice: labelMatch };
  }

  return {
    ...context,
    kind: 'free_text',
    text: request.action,
    statUsed: request.statUsed as Stat | 'none',
    difficulty: (request.difficulty || 'normal') as Difficulty,
    ...(request.difficultyValue != null && { difficultyValue: request.difficultyValue }),
    ...(request.previewId && { previewId: request.previewId }),
  };
};

export const isRejection = (value: TurnAction | TurnActionRejection): value is TurnActionRejection =>
  'ok' in value && value.ok === false;

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
    if (!character.inventory.some(item => item.id === action.itemId)) {
      return rejectTurnAction(400, { error: 'item_not_found', message: 'That item is no longer in this hero\'s pack.' });
    }
    if (action.kind === 'item_give' && !session.party.some(c => c.id === (action.targetCharacterId || action.actorId))) {
      return rejectTurnAction(400, { error: 'target_not_found', message: 'That hero is no longer in the party.' });
    }
    return null;
  }

  if (character.status === 'downed') {
    return rejectTurnAction(400, { error: 'downed', message: `${character.name} is downed and cannot act.` });
  }

  if (action.kind === 'free_text' && action.previewId) {
    const lookup = lookupActionPreview(action.previewId, session.id, session.revision ?? 0, character.id);
    if (lookup.status !== 'valid') {
      return rejectTurnAction(409, { error: 'stale_preview', message: 'The scene changed since this action was previewed. Review it again before confirming.' });
    }
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
