import { z } from 'zod';

const choiceSchema = z.object({
  label: z.string().min(1),
  difficulty: z.enum(['easy', 'normal', 'hard']),
  stat: z.enum(['might', 'magic', 'mischief']),
});

const inventoryAddSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  statBonuses: z.object({
    might: z.number().optional(),
    magic: z.number().optional(),
    mischief: z.number().optional(),
  }),
  healValue: z.number().optional(),
  consumable: z.boolean().optional(),
  transferable: z.boolean().optional(),
});

export const narrationOutputSchema = z.object({
  narration: z.string().min(1),
  choices: z.array(choiceSchema).length(3),
  imagePrompt: z.string().nullable(),
  imageSuggested: z.boolean(),
  suggestedInventoryAdd: inventoryAddSchema.nullable(),
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
  suggestedInventoryAdd: null,
};
