import { z } from 'zod';
import { CHOICE_FLAVOR_VALUES, DIFFICULTY_VALUES, STAT_VALUES, TENSION_LEVEL_VALUES } from '../../../types.js';

const choiceSchema = z.object({
  label: z.string().min(1),
  difficulty: z.enum(DIFFICULTY_VALUES),
  stat: z.enum(STAT_VALUES),
  difficultyValue: z.number().int().min(1).max(20),
  narration: z.string().optional(),
  riddleAnswer: z.string().min(1).optional(),
  riddleCorrect: z.boolean().optional(),
  flavor: z.enum(CHOICE_FLAVOR_VALUES).optional(),
  helperCharacterName: z.string().min(1).optional(),
  itemOwnerName: z.string().min(1).optional(),
  itemName: z.string().min(1).optional(),
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
  tags: z.array(z.string().min(1)).max(5).optional(),
  effect: z.string().optional(),
  charges: z.number().int().min(0).max(9).optional(),
  condition: z.string().optional(),
  boundToCharacterName: z.string().optional(),
});

const inventoryRemoveSchema = z.object({
  characterName: z.string().min(1),
  itemName: z.string().min(1),
});

const inventoryUpdateSchema = z.object({
  characterName: z.string().min(1),
  itemName: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  statBonuses: z.object({
    might: z.number().optional(),
    magic: z.number().optional(),
    mischief: z.number().optional(),
  }).optional(),
  healValue: z.number().optional(),
  consumable: z.boolean().optional(),
  transferable: z.boolean().optional(),
  tags: z.array(z.string().min(1)).max(5).optional(),
  effect: z.string().optional(),
  charges: z.number().int().min(0).max(9).optional(),
  condition: z.string().optional(),
  boundToCharacterName: z.string().optional(),
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
  currentTensionLevel: z.enum(TENSION_LEVEL_VALUES).default('medium'),
  suggestedInventoryAdd: inventoryAddSchema.nullable(),
  suggestedInventoryRemove: inventoryRemoveSchema.nullable().default(null),
  suggestedInventoryUpdate: inventoryUpdateSchema.nullable().default(null),
  suggestedRevive: reviveSchema.nullable().default(null),
  suggestedHeal: z.array(reviveSchema).nullable().default(null),
  suggestedDamage: z.number().int().min(0).max(20).nullable().default(null),
});

export type ValidNarrationOutput = z.infer<typeof narrationOutputSchema>;

export const NARRATION_FALLBACK: ValidNarrationOutput = {
  narration: 'The situation grows more mysterious, but the adventure continues.',
  choices: [
    { label: 'Inspect the area', difficulty: 'easy', stat: 'might', difficultyValue: 8, narration: 'You examine your surroundings carefully.' },
    { label: 'Talk to someone nearby', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, narration: 'Perhaps someone here knows more than they are letting on.' },
    { label: 'Use your magic', difficulty: 'normal', stat: 'magic', difficultyValue: 12, narration: 'Channel the arcane to reveal what lies hidden.' },
  ],
  imagePrompt: null,
  imageSuggested: false,
  currentTensionLevel: 'medium',
  suggestedInventoryAdd: null,
  suggestedInventoryRemove: null,
  suggestedInventoryUpdate: null,
  suggestedRevive: null,
  suggestedHeal: null,
  suggestedDamage: null,
};
