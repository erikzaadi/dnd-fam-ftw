import { z } from 'zod';

const choiceSchema = z.object({
  label: z.string().min(1),
  difficulty: z.enum(['easy', 'normal', 'hard']),
  stat: z.enum(['might', 'magic', 'mischief']),
  difficultyValue: z.number().int().min(2).max(20).optional(),
});

const inventoryAddSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  targetCharacterName: z.string().optional(),
  statBonuses: z.object({
    might: z.number().optional(),
    magic: z.number().optional(),
    mischief: z.number().optional(),
  }),
  healValue: z.number().optional(),
  consumable: z.boolean().optional(),
  transferable: z.boolean().optional(),
});

const inventoryRemoveSchema = z.object({
  characterName: z.string().min(1),
  itemName: z.string().min(1),
});

const reviveSchema = z.object({
  characterName: z.string().min(1),
  hp: z.number().int().min(1).max(999),
});

export const narrationOutputSchema = z.object({
  narration: z.string().min(1),
  choices: z.array(choiceSchema).length(3),
  rollNarration: z.string().optional(),
  imagePrompt: z.string().nullable(),
  imageSuggested: z.boolean(),
  currentTensionLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  suggestedInventoryAdd: inventoryAddSchema.nullable(),
  suggestedInventoryRemove: inventoryRemoveSchema.nullable().default(null),
  suggestedRevive: reviveSchema.nullable().default(null),
  suggestedHeal: z.array(reviveSchema).nullable().default(null),
  suggestedDamage: z.number().int().min(0).max(20).nullable().default(null),
});

export type ValidNarrationOutput = z.infer<typeof narrationOutputSchema>;

export const NARRATION_FALLBACK: ValidNarrationOutput = {
  narration: 'The situation grows more mysterious, but the adventure continues.',
  choices: [
    { label: 'Inspect the area', difficulty: 'easy', stat: 'might' },
    { label: 'Talk to someone nearby', difficulty: 'normal', stat: 'mischief' },
    { label: 'Use your magic', difficulty: 'normal', stat: 'magic' },
  ],
  imagePrompt: null,
  imageSuggested: false,
  currentTensionLevel: 'medium',
  suggestedInventoryAdd: null,
  suggestedInventoryRemove: null,
  suggestedRevive: null,
  suggestedHeal: null,
  suggestedDamage: null,
};
