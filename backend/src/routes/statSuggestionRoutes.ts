import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { createChatClient } from '../providers/ai/AiProviderFactory.js';
import { StateService } from '../services/stateService.js';
import { parseSuggestedStats, STAT_FALLBACK } from '../services/statSuggestionService.js';
import { parseBody } from './routeValidation.js';

const suggestStatBodySchema = z.object({
  action: z.string(),
  characterClass: z.string().optional(),
  characterQuirk: z.string().optional(),
});

const suggestCharacterStatsBodySchema = z.object({
  name: z.string().optional(),
  class: z.string().optional(),
  species: z.string().optional(),
  quirk: z.string().optional(),
  useLocalAI: z.boolean().optional(),
});

export const createStatSuggestionRouter = () => {
  const router = Router();

  router.post('/session/:id/suggest-stat', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, suggestStatBodySchema);
    if (!body) {
      return;
    }
    const { action, characterClass, characterQuirk } = body;
    const session = await StateService.getSession(req.params.id as string);
    if (!session) {
      res.status(404).json({ stat: 'mischief' });
      return;
    }

    const { client, model } = createChatClient(session.useLocalAI);
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{
          role: 'user',
          content: `/no_think A fantasy RPG character${characterClass ? ` (${characterClass})` : ''}${characterQuirk ? `, quirk: ${characterQuirk}` : ''} wants to: "${action}". Which single stat fits best: might (physical strength, combat, force), magic (spells, arcane, healing, divine), or mischief (stealth, trickery, charm, persuasion, deception)? Reply with ONLY one word: might, magic, or mischief.`
        }],
        max_tokens: 10,
      }, { signal: AbortSignal.timeout(8_000) });
      const raw = (response.choices[0].message.content ?? '').toLowerCase().trim().replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const stat = ['might', 'magic', 'mischief'].find(s => raw.includes(s)) ?? 'mischief';
      res.json({ stat });
    } catch {
      res.json({ stat: 'mischief' });
    }
  }));

  router.post('/character/suggest-stats', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, suggestCharacterStatsBodySchema);
    if (!body) {
      return;
    }
    const { name, class: charClass, species, quirk, useLocalAI } = body;
    const { client, model } = createChatClient(!!useLocalAI);
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{
          role: 'user',
          content: `/no_think Assign starting stats for a fantasy RPG character. Stats: might (physical), magic (arcane), mischief (cunning/charm). Distribute exactly 7 points total. Each stat: min 1, max 5. Rules: ALWAYS put the highest stat (4 or 5) in the primary archetype stat. Never distribute evenly (3/2/2 is bad). Archetypes: Fighter/Warrior/Barbarian/Knight = might 4-5. Mage/Wizard/Sorcerer/Witch = magic 4-5. Rogue/Thief/Bard/Trickster = mischief 4-5. Cleric/Druid = magic 3-4. Paladin = might 3-4. Let species and quirk shift the secondary stat. Examples: "Fighter Dwarf" = {"might":5,"magic":1,"mischief":1}. "Mage Elf" = {"might":1,"magic":5,"mischief":1}. "Rogue Halfling" = {"might":1,"magic":1,"mischief":5}. "Cleric Human" = {"might":2,"magic":4,"mischief":1}.

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
