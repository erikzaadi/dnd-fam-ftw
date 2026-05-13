import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { createChatClient } from '../providers/ai/AiProviderFactory.js';
import { buildEncounterContextFromEnemies, parseSuggestedStats, previewFreeAction, STAT_FALLBACK, suggestPreviewActionText, suggestStatForSessionAction } from '../services/statSuggestionService.js';
import { parseBody } from './routeValidation.js';
import type { FreeActionPreview } from '@dnd-fam-ftw/shared';
import { buildFreeActionWarnings, getFreeActionDifficulty } from '../services/freeActionPolicyService.js';
import { registerSessionIdParam } from '../middleware/sessionParam.js';

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
}).strict();

const suggestCharacterStatsBodySchema = z.object({
  name: z.string().optional(),
  class: z.string().optional(),
  species: z.string().optional(),
  quirk: z.string().optional(),
});

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
    const body = parseBody(req, res, previewActionBodySchema);
    if (!body) {
      return;
    }
    const session = req.session!;
    const action = body.action?.trim() || await suggestPreviewActionText(req.params.id as string, body);
    const encounterContext = session.encounterState?.status === 'active'
      ? buildEncounterContextFromEnemies(session.encounterState.enemies)
      : null;
    const suggestion = await previewFreeAction(req.params.id as string, { action, encounterContext });
    const interpretedAction = suggestion.interpretedAction ?? action;
    const SUPPORT_INTENTS = new Set(['bless_character', 'aid_character', 'improve_item', 'party_boost']);
    const isSupportIntent = !!body.intent && SUPPORT_INTENTS.has(body.intent);
    const { difficulty, difficultyValue } = isSupportIntent
      ? { difficulty: 'easy' as const, difficultyValue: 8 }
      : getFreeActionDifficulty(interpretedAction);
    const preview: FreeActionPreview = {
      originalAction: body.action?.trim() ?? action,
      interpretedAction,
      stat: suggestion.stat,
      difficulty,
      ...(difficultyValue !== undefined && { difficultyValue }),
      warnings: buildFreeActionWarnings(interpretedAction, session),
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
    res.json(preview);
  }));

  router.post('/character/suggest-stats', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, suggestCharacterStatsBodySchema);
    if (!body) {
      return;
    }
    const { name, class: charClass, species, quirk } = body;
    const { client, model } = createChatClient();
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
        max_tokens: 60,
      }, { signal: AbortSignal.timeout(10_000) });

      const raw = response.choices[0].message.content ?? '';
      res.json(parseSuggestedStats(raw));
    } catch {
      res.json({ ...STAT_FALLBACK });
    }
  }));

  return router;
};
