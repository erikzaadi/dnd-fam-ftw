import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { createChatClientForTier } from '../providers/ai/AiProviderFactory.js';
import { getTierRequestSettings, warnIfEmptyTruncation } from '../providers/ai/openAiClient.js';
import { parseSuggestedStats, STAT_FALLBACK, suggestStatForSessionAction } from '../services/statSuggestionService.js';
import { parseBody } from './routeValidation.js';
import { registerSessionIdParam } from '../middleware/sessionParam.js';
import { MAX_CLARIFICATION_ROUNDS, previewAction } from '../services/actionPreviewService.js';

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
    const { supports, ...request } = body;
    const outcome = await previewAction(req.session!, req.namespaceId ?? 'local', request, {
      supportsClarification: supportsClarificationRequest(supports),
    });
    if (outcome.type === 'error') {
      res.status(outcome.status).json({ error: outcome.error, message: outcome.message });
      return;
    }
    res.json(outcome.type === 'clarification' ? outcome.clarification : outcome.preview);
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
