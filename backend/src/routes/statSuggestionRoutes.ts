import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';
import { getTierRequestSettings, warnIfEmptyTruncation } from '../providers/ai/openAiClient.js';
import { buildEncounterContextFromEnemies, parseSuggestedStats, previewFreeAction, STAT_FALLBACK, suggestStatForSessionAction } from '../services/statSuggestionService.js';
import { parseBody } from './routeValidation.js';
import type { FreeActionPreview, PreviewClarification } from '@dnd-fam-ftw/shared';
import type { SessionState } from '../types.js';
import { buildFreeActionWarnings, getFreeActionDifficulty } from '../services/freeActionPolicyService.js';
import { registerSessionIdParam } from '../middleware/sessionParam.js';
import { devLog } from '../lib/devLog.js';
import { storeActionPreview, type StoredActionPreview } from '../services/actionPreviewStore.js';
import { StateService } from '../services/stateService.js';
import { assessRiddleAction, ensureActiveRiddle, RIDDLE_ANSWER_UNKNOWN_MESSAGE } from '../services/riddleService.js';
import { scheduleRiddleRecovery } from '../services/riddleRecoveryService.js';

// After this many rounds the player is asked to rephrase instead of answering again.
const MAX_CLARIFICATION_ROUNDS = 2;

const supportsClarificationRequest = (supports: string[] | undefined): boolean => supports?.includes('clarification') ?? false;

const suggestStatBodySchema = z.object({
  action: z.string().min(1),
}).strict();

const previewActionBodySchema = z.object({
  action: z.string().min(1).optional(),
  intent: z.enum(['use_item_scene', 'improve_item', 'bless_character', 'aid_character', 'party_boost']).optional(),
  targetCharacterId: z.string().optional(),
  itemOwnerCharacterId: z.string().optional(),
  itemId: z.string().optional(),
  method: z.enum(['enchant', 'craft', 'tinker']).optional(),
  // Clients that can show a clarification question in place declare it; others get
  // the question as a retryable error message.
  supports: z.array(z.enum(['clarification'])).max(4).optional(),
  // Earlier question-and-answer rounds about this same draft (action).
  // Gear attached to the draft (inventory "Use" / "Give"). Previewed without a model
  // call: the item's own effect decides, so there is no roll.
  attachment: z.object({
    actionType: z.enum(['use_item', 'give_item']),
    itemId: z.string().min(1).max(100),
    ownerCharacterId: z.string().min(1).max(100),
    targetCharacterId: z.string().min(1).max(100).optional(),
  }).strict().optional(),
  clarifications: z.array(z.object({
    question: z.string().min(1).max(300),
    answer: z.string().trim().min(1).max(600),
  }).strict()).max(MAX_CLARIFICATION_ROUNDS).optional(),
}).strict();

const suggestCharacterStatsBodySchema = z.object({
  name: z.string().optional(),
  class: z.string().optional(),
  species: z.string().optional(),
  quirk: z.string().optional(),
});

type ItemAttachment = { actionType: 'use_item' | 'give_item'; itemId: string; ownerCharacterId: string; targetCharacterId?: string };

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

export const createStatSuggestionRouter = () => {
  const router = Router();
  registerSessionIdParam(router);

  router.post('/session/:id/suggest-stat', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, suggestStatBodySchema);
    if (!body) {
      return;
    }
    const suggestion = await suggestStatForSessionAction(req.params.id as string, body);
    res.json(suggestion);
  }));

  router.post('/session/:id/preview-action', asyncHandler(async (req, res) => {
    const start = Date.now();
    const body = parseBody(req, res, previewActionBodySchema);
    if (!body) {
      return;
    }
    const sessionId = req.params.id as string;
    let stepStart = Date.now();
    const session = req.session!;
    // Riddle answers are judged on the player's own words before any model call. An
    // answer the server cannot judge comes back as a retryable error with a question.
    if (body.attachment) {
      const itemPreview = buildItemPreview(session, body.attachment, body.action?.trim());
      if ('error' in itemPreview) {
        res.status(409).json({ error: 'item_unavailable', message: itemPreview.error });
        return;
      }
      const { preview, stored } = itemPreview;
      if (StateService.getRevision(sessionId) === (session.revision ?? 0)) {
        preview.previewId = storeActionPreview({ sessionId, revision: session.revision ?? 0, actingCharacterId: session.activeCharacterId, ...stored });
      }
      res.json(preview);
      return;
    }

    const clarifications = body.clarifications ?? [];
    const activeRiddle = body.action && !body.intent ? ensureActiveRiddle(session) : null;
    const riddle = body.action && !body.intent
      ? assessRiddleAction({ kind: 'free_text', text: body.action, clarifications }, activeRiddle)
      : { type: 'not_answer' as const };
    if (riddle.type === 'unclear') {
      if (clarifications.length >= MAX_CLARIFICATION_ROUNDS) {
        res.status(409).json({ error: 'clarification_limit', message: 'Try describing it another way.' });
        return;
      }
      if (supportsClarificationRequest(body.supports)) {
        const clarification: PreviewClarification = { kind: 'clarification', question: riddle.question, previewRevision: session.revision ?? 0 };
        res.json(clarification);
        return;
      }
      res.status(409).json({ error: 'riddle_unclear', message: riddle.question });
      return;
    }
    if (riddle.type === 'answer_unknown') {
      scheduleRiddleRecovery(sessionId, req.namespaceId ?? 'local', activeRiddle);
      res.status(409).json({ error: 'riddle_answer_unknown', message: RIDDLE_ANSWER_UNKNOWN_MESSAGE });
      return;
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
    const supportsClarification = supportsClarificationRequest(body.supports);
    const suggestion = await previewFreeAction(sessionId, {
      action: modelAction,
      context: body,
      encounterContext,
      allowClarification: supportsClarification && !body.intent && !!body.action && clarifications.length < MAX_CLARIFICATION_ROUNDS,
    });
    if (suggestion.clarificationQuestion) {
      const clarification: PreviewClarification = { kind: 'clarification', question: suggestion.clarificationQuestion, previewRevision: session.revision ?? 0 };
      res.json(clarification);
      return;
    }
    devLog.log(`[PreviewAction] preview-free-action session=${sessionId} durationMs=${Date.now() - stepStart} stat=${suggestion.stat} generated=${suggestion.generatedAction ? 'true' : 'false'} interpreted=${suggestion.interpretedAction ? 'true' : 'false'}`);
    stepStart = Date.now();
    const resolvedAction = body.action?.trim() ?? suggestion.generatedAction ?? '';
    const interpretedAction = suggestion.interpretedAction ?? resolvedAction;
    const SUPPORT_INTENTS = new Set(['bless_character', 'aid_character', 'improve_item', 'party_boost']);
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
    if (StateService.getRevision(sessionId) === previewRevision) {
      preview.previewId = storeActionPreview({
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
      });
    }
    devLog.log(`[PreviewAction] response session=${sessionId} durationMs=${Date.now() - stepStart} totalMs=${Date.now() - start}`);
    res.json(preview);
  }));

  router.post('/character/suggest-stats', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, suggestCharacterStatsBodySchema);
    if (!body) {
      return;
    }
    const { name, class: charClass, species, quirk } = body;
    const { client, model } = createChatClientForTier('preview');
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{
          role: 'user',
          content: `Assign starting stats for a fantasy RPG character. Stats: might (physical), magic (arcane), mischief (cunning/charm). Distribute exactly 7 points total. Each stat: min 1, max 5. Rules: ALWAYS put the highest stat (4 or 5) in the primary archetype stat. Never distribute evenly (3/2/2 is bad). Archetypes: Fighter/Warrior/Barbarian/Knight = might 4-5. Mage/Wizard/Sorcerer/Witch = magic 4-5. Rogue/Thief/Bard/Trickster = mischief 4-5. Cleric/Druid = magic 3-4. Paladin = might 3-4. Let species and quirk shift the secondary stat. Examples: "Fighter Dwarf" = {"might":5,"magic":1,"mischief":1}. "Mage Elf" = {"might":1,"magic":5,"mischief":1}. "Rogue Halfling" = {"might":1,"magic":1,"mischief":5}. "Cleric Human" = {"might":2,"magic":4,"mischief":1}.

Character:
- Name: ${name}
- Class: ${charClass}
- Species: ${species}
- Quirk: ${quirk}

Reply with ONLY valid JSON: {"might": N, "magic": N, "mischief": N}`
        }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 60,
        ...getTierRequestSettings('preview'),
      }, { signal: AbortSignal.timeout(10_000) });
      warnIfEmptyTruncation('CharacterStatSuggestion', model, response.choices[0]);

      const raw = response.choices[0].message.content ?? '';
      res.json(parseSuggestedStats(raw));
    } catch {
      res.json({ ...STAT_FALLBACK });
    }
  }));

  return router;
};
