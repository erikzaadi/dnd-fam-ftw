import { z } from 'zod';
import { CHOICE_FLAVOR_VALUES, DIFFICULTY_VALUES, STAT_VALUES, TENSION_LEVEL_VALUES } from '../../../types.js';

const choiceSchema = z.object({
  label: z.string().min(1),
  difficulty: z.enum(DIFFICULTY_VALUES),
  stat: z.enum(STAT_VALUES),
  difficultyValue: z.number().int().min(1).max(20),
  narration: z.string().optional().nullable(),
  riddleAnswer: z.string().min(1).optional().nullable(),
  riddleCorrect: z.boolean().optional().nullable(),
  flavor: z.enum(CHOICE_FLAVOR_VALUES).optional().nullable(),
  helperCharacterName: z.string().min(1).optional().nullable(),
  itemOwnerName: z.string().min(1).optional().nullable(),
  itemName: z.string().min(1).optional().nullable(),
  environmentFeature: z.string().min(1).optional().nullable(),
});

const inventoryAddSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  targetCharacterName: z.string().optional().nullable(),
  statBonuses: z.object({
    might: z.number().optional().nullable(),
    magic: z.number().optional().nullable(),
    mischief: z.number().optional().nullable(),
  }),
  healValue: z.number().optional().nullable(),
  consumable: z.boolean().optional().nullable(),
  transferable: z.boolean().optional().nullable(),
  tags: z.array(z.string().min(1)).max(5).optional().nullable(),
  effect: z.string().optional().nullable(),
  charges: z.number().int().min(0).max(9).optional().nullable(),
  condition: z.string().optional().nullable(),
  boundToCharacterName: z.string().optional().nullable(),
});

const inventoryRemoveSchema = z.object({
  characterName: z.string().min(1),
  itemName: z.string().min(1),
});

const inventoryUpdateSchema = z.object({
  characterName: z.string().min(1),
  itemName: z.string().min(1),
  name: z.string().min(1).optional().nullable(),
  description: z.string().min(1).optional().nullable(),
  statBonuses: z.object({
    might: z.number().optional().nullable(),
    magic: z.number().optional().nullable(),
    mischief: z.number().optional().nullable(),
  }).optional().nullable(),
  healValue: z.number().optional().nullable(),
  consumable: z.boolean().optional().nullable(),
  transferable: z.boolean().optional().nullable(),
  tags: z.array(z.string().min(1)).max(5).optional().nullable(),
  effect: z.string().optional().nullable(),
  charges: z.number().int().min(0).max(9).optional().nullable(),
  condition: z.string().optional().nullable(),
  boundToCharacterName: z.string().optional().nullable(),
});

const reviveSchema = z.object({
  characterName: z.string().min(1),
  hp: z.number().int().min(1).max(999),
});

export const narrationOutputSchema = z.object({
  narration: z.string().min(1),
  choices: z.array(choiceSchema).length(3),
  rollNarration: z.string().optional().nullable(),
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
