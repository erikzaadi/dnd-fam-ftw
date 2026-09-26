import type { ActionClarification, FreeActionPreview, PreviewClarification, SessionState } from '../types.js';
import { buildEncounterContextFromEnemies, previewFreeAction } from './statSuggestionService.js';
import { buildFreeActionWarnings, getFreeActionDifficulty } from './freeActionPolicyService.js';
import { devLog } from '../lib/devLog.js';
import { storeActionPreviewRecord, type StoredActionPreview } from './actionPreviewStore.js';
import { StateService } from './stateService.js';
import { assessRiddleAction, ensureActiveRiddle, RIDDLE_ANSWER_UNKNOWN_MESSAGE } from './riddleService.js';
import { scheduleRiddleRecovery } from './riddleRecoveryService.js';

// Transport-neutral action preview, shared by POST /session/:id/preview-action and the
// MCP preview_action tool. Interprets a draft, settles its mechanics, and stores them
// server-side under a preview id that a later confirmation must present.

// After this many rounds the player is asked to rephrase instead of answering again.
export const MAX_CLARIFICATION_ROUNDS = 2;

export type ItemAttachment = { actionType: 'use_item' | 'give_item'; itemId: string; ownerCharacterId: string; targetCharacterId?: string };

export type ActionPreviewRequest = {
  action?: string;
  intent?: 'use_item_scene' | 'improve_item' | 'bless_character' | 'aid_character' | 'party_boost';
  targetCharacterId?: string;
  itemOwnerCharacterId?: string;
  itemId?: string;
  method?: 'enchant' | 'craft' | 'tinker';
  attachment?: ItemAttachment;
  clarifications?: ActionClarification[];
};

export type ActionPreviewOptions = {
  // The client can show a clarification question in place; others get it as an error.
  supportsClarification: boolean;
  // Binds the stored preview to one caller (MCP token), so only it can confirm.
  principal?: string;
};

export type ActionPreviewOutcome =
  | { type: 'preview'; preview: FreeActionPreview; stored: StoredActionPreview | null }
  | { type: 'clarification'; clarification: PreviewClarification }
  | { type: 'error'; status: number; error: string; message: string };

// A deterministic preview for a draft with gear attached. The stored record carries the
// item, owner, and target, so confirmation resolves exactly this item action.
const buildItemPreview = (
  session: SessionState,
  attachment: ItemAttachment,
  playerText: string | undefined,
): { error: string } | { preview: FreeActionPreview; stored: Omit<StoredActionPreview, 'id' | 'createdAt' | 'sessionId' | 'revision' | 'actingCharacterId'> } => {
  const owner = session.party.find(c => c.id === attachment.ownerCharacterId);
  const item = owner?.inventory.find(i => i.id === attachment.itemId);
  if (!owner || !item) {
    return { error: 'That item is no longer in this hero\'s pack. Pick it again from the gear.' };
  }
  const target = attachment.targetCharacterId ? session.party.find(c => c.id === attachment.targetCharacterId) : undefined;
  if ((attachment.targetCharacterId && !target) || (attachment.actionType === 'give_item' && !target)) {
    return { error: 'That hero is no longer in the party. Pick the gear again.' };
  }
  const kind = attachment.actionType === 'use_item' ? 'item_use' as const : 'item_give' as const;
  const template = kind === 'item_give'
    ? `${owner.name} gives ${item.name} to ${target!.name}`
    : target && target.id !== owner.id
      ? `${owner.name} uses ${item.name} on ${target.name}`
      : `${owner.name} uses ${item.name}`;
  const text = playerText || template;
  return {
    preview: {
      originalAction: text,
      interpretedAction: text,
      stat: 'mischief',
      difficulty: 'easy',
      warnings: [],
      itemAction: { kind, itemName: item.name, ownerName: owner.name, ...(target && { targetName: target.name }) },
    },
    stored: {
      kind,
      originalAction: text,
      interpretedAction: text,
      itemId: item.id,
      itemOwnerCharacterId: owner.id,
      ...(target && { targetCharacterId: target.id }),
      stat: 'mischief',
      difficulty: 'easy',
    },
  };
};

const SUPPORT_INTENTS = new Set(['bless_character', 'aid_character', 'improve_item', 'party_boost']);

export const previewAction = async (
  session: SessionState,
  namespaceId: string,
  body: ActionPreviewRequest,
  options: ActionPreviewOptions,
): Promise<ActionPreviewOutcome> => {
  const start = Date.now();
  const sessionId = session.id;
  const principal = options.principal ? { principal: options.principal } : {};
  let stepStart = Date.now();
  if (body.attachment) {
    const itemPreview = buildItemPreview(session, body.attachment, body.action?.trim());
    if ('error' in itemPreview) {
      return { type: 'error', status: 409, error: 'item_unavailable', message: itemPreview.error };
    }
    const { preview, stored } = itemPreview;
    let record: StoredActionPreview | null = null;
    if (StateService.getRevision(sessionId) === (session.revision ?? 0)) {
      record = storeActionPreviewRecord({ sessionId, revision: session.revision ?? 0, actingCharacterId: session.activeCharacterId, ...stored, ...principal, publicPreview: preview });
      preview.previewId = record.id;
    }
    return { type: 'preview', preview, stored: record };
  }

  // Riddle answers are judged on the player's own words before any model call. An
  // answer the server cannot judge comes back as a retryable error with a question.
  const clarifications = body.clarifications ?? [];
  const activeRiddle = body.action && !body.intent ? ensureActiveRiddle(session) : null;
  const riddle = body.action && !body.intent
    ? assessRiddleAction({ kind: 'free_text', text: body.action, clarifications }, activeRiddle)
    : { type: 'not_answer' as const };
  if (riddle.type === 'unclear') {
    if (clarifications.length >= MAX_CLARIFICATION_ROUNDS) {
      return { type: 'error', status: 409, error: 'clarification_limit', message: 'Try describing it another way.' };
    }
    if (options.supportsClarification) {
      return { type: 'clarification', clarification: { kind: 'clarification', question: riddle.question, previewRevision: session.revision ?? 0 } };
    }
    return { type: 'error', status: 409, error: 'riddle_unclear', message: riddle.question };
  }
  if (riddle.type === 'answer_unknown') {
    scheduleRiddleRecovery(sessionId, namespaceId, activeRiddle);
    return { type: 'error', status: 409, error: 'riddle_answer_unknown', message: RIDDLE_ANSWER_UNKNOWN_MESSAGE };
  }
  devLog.log(`[PreviewAction] start session=${sessionId} hasAction=${body.action ? 'true' : 'false'} intent=${body.intent ?? 'custom'} encounter=${session.encounterState?.status ?? 'none'}`);
  const encounterContext = session.encounterState?.status === 'active'
    ? buildEncounterContextFromEnemies(session.encounterState.enemies)
    : null;
  devLog.log(`[PreviewAction] encounter-context session=${sessionId} durationMs=${Date.now() - stepStart} enemies=${encounterContext?.activeEnemies.length ?? 0}`);
  stepStart = Date.now();
  // The model reads the draft together with the exchange, so "the goblin" completes
  // "I throw it at them". The player's own draft stays the original action.
  const modelAction = body.action?.trim() && clarifications.length > 0
    ? `${body.action.trim()} (${clarifications.map(c => `asked "${c.question}", the player answered "${c.answer}"`).join('; ')})`
    : body.action?.trim();
  // The model may ask about a missing target or intent, but only clients that can show
  // the question get one, and never past the round limit (then it interprets).
  const suggestion = await previewFreeAction(sessionId, {
    action: modelAction,
    context: body,
    encounterContext,
    allowClarification: options.supportsClarification && !body.intent && !!body.action && clarifications.length < MAX_CLARIFICATION_ROUNDS,
  });
  if (suggestion.clarificationQuestion) {
    return { type: 'clarification', clarification: { kind: 'clarification', question: suggestion.clarificationQuestion, previewRevision: session.revision ?? 0 } };
  }
  devLog.log(`[PreviewAction] preview-free-action session=${sessionId} durationMs=${Date.now() - stepStart} stat=${suggestion.stat} generated=${suggestion.generatedAction ? 'true' : 'false'} interpreted=${suggestion.interpretedAction ? 'true' : 'false'}`);
  stepStart = Date.now();
  const resolvedAction = body.action?.trim() ?? suggestion.generatedAction ?? '';
  const interpretedAction = suggestion.interpretedAction ?? resolvedAction;
  const isSupportIntent = !!body.intent && SUPPORT_INTENTS.has(body.intent);
  const { difficulty, difficultyValue } = isSupportIntent
    ? { difficulty: 'easy' as const, difficultyValue: 8 }
    : getFreeActionDifficulty(interpretedAction);
  const preview: FreeActionPreview = {
    originalAction: resolvedAction,
    interpretedAction,
    stat: suggestion.stat,
    difficulty,
    ...(difficultyValue !== undefined && { difficultyValue }),
    warnings: [
      ...(riddle.type === 'answer' ? ['Riddle answer: no dice roll, the riddle decides.'] : []),
      ...buildFreeActionWarnings(interpretedAction, session),
    ],
    ...(suggestion.narration !== undefined && { narration: suggestion.narration }),
    ...(suggestion.helperBonus !== undefined && { helperBonus: suggestion.helperBonus }),
    ...(suggestion.helperCharacterName !== undefined && { helperCharacterName: suggestion.helperCharacterName }),
    ...(suggestion.choiceItemBonus !== undefined && { choiceItemBonus: suggestion.choiceItemBonus }),
    ...(suggestion.choiceItemName !== undefined && { choiceItemName: suggestion.choiceItemName }),
    ...(suggestion.choiceItemOwnerName !== undefined && { choiceItemOwnerName: suggestion.choiceItemOwnerName }),
    ...(suggestion.characterBonus !== undefined && { characterBonus: suggestion.characterBonus }),
    ...(suggestion.characterBonusLabel !== undefined && { characterBonusLabel: suggestion.characterBonusLabel }),
    ...(suggestion.flavor !== undefined && { flavor: suggestion.flavor }),
    ...(suggestion.school !== undefined && { school: suggestion.school }),
    ...(suggestion.actionTags !== undefined && { actionTags: suggestion.actionTags }),
    ...(suggestion.likelyEnemyId !== undefined && { likelyEnemyId: suggestion.likelyEnemyId }),
    ...(suggestion.likelyEnemyName !== undefined && { likelyEnemyName: suggestion.likelyEnemyName }),
    ...(suggestion.weakPointMatch !== undefined && { weakPointMatch: suggestion.weakPointMatch }),
  };
  // Bind the mechanics to the revision the preview was computed against. Revision is
  // re-read now: if the story moved while the preview was thinking, the handle is
  // already stale and confirmation will ask for a fresh preview.
  const previewRevision = session.revision ?? 0;
  let record: StoredActionPreview | null = null;
  if (StateService.getRevision(sessionId) === previewRevision) {
    record = storeActionPreviewRecord({
      sessionId,
      revision: previewRevision,
      actingCharacterId: session.activeCharacterId,
      kind: 'free_text',
      originalAction: resolvedAction,
      interpretedAction,
      ...(body.intent && { actionIntent: body.intent }),
      ...(body.itemId && { itemId: body.itemId }),
      ...(body.itemOwnerCharacterId && { itemOwnerCharacterId: body.itemOwnerCharacterId }),
      ...(body.targetCharacterId && { targetCharacterId: body.targetCharacterId }),
      ...(clarifications.length > 0 && { clarifications }),
      stat: suggestion.stat,
      difficulty,
      ...(difficultyValue !== undefined && { difficultyValue }),
      ...principal,
      publicPreview: preview,
    });
    preview.previewId = record.id;
  }
  devLog.log(`[PreviewAction] response session=${sessionId} durationMs=${Date.now() - stepStart} totalMs=${Date.now() - start}`);
  return { type: 'preview', preview, stored: record };
};
