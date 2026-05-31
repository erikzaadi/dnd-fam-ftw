import { z } from 'zod';
import type { EncounterStartProposal } from '../../../types.js';
import { CHOICE_FLAVOR_VALUES, DIFFICULTY_VALUES, STAT_VALUES, TENSION_LEVEL_VALUES } from '../../../types.js';

const ENCOUNTER_SCHOOLS = ['fire', 'frost', 'light', 'shadow', 'nature', 'storm', 'mind', 'force', 'holy', 'mechanical'] as const;
const ENCOUNTER_ROLES = ['minion', 'standard', 'elite', 'boss', 'hazard'] as const;
const ENCOUNTER_ENEMY_STATUSES = ['defeated', 'fled', 'surrendered'] as const;
const ENCOUNTER_EFFECT_KINDS = ['buff', 'curse', 'damage_over_time', 'control', 'marked'] as const;

const encounterWeaknessProposalSchema = z.object({
  label: z.string().min(1),
  school: z.enum(ENCOUNTER_SCHOOLS).optional().nullable(),
});

const encounterEnemyProposalSchema = z.object({
  name: z.string().min(1),
  role: z.enum(ENCOUNTER_ROLES),
  traits: z.array(z.string().min(1)).max(6).optional().nullable(),
  weaknesses: z.array(encounterWeaknessProposalSchema).max(4).optional().nullable(),
});

const encounterAreaProposalSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional().nullable(),
  tags: z.array(z.string().min(1)).max(5).optional().nullable(),
});

export const suggestedEncounterStartSchema: z.ZodType<EncounterStartProposal> = z.object({
  name: z.string().min(1),
  enemies: z.array(encounterEnemyProposalSchema).min(1).max(3),
  areas: z.array(encounterAreaProposalSchema).max(4).optional().nullable(),
  objective: z.string().optional().nullable(),
  lootHint: z.string().optional().nullable(),
});

const enemyTargetSchema = z.object({
  enemyId: z.string().optional().nullable(),
  enemyName: z.string().optional().nullable(),
});

const encounterEffectProposalSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  kind: z.enum(ENCOUNTER_EFFECT_KINDS),
  damagePerTurn: z.number().int().min(0).max(4).optional().nullable(),
  remainingTurns: z.number().int().min(1).max(6).optional().nullable(),
  statBonuses: z.object({
    might: z.number().optional().nullable(),
    magic: z.number().optional().nullable(),
    mischief: z.number().optional().nullable(),
  }).optional().nullable(),
});

export const suggestedEncounterUpdateSchema = z.object({
  enemyDamage: z.array(enemyTargetSchema.extend({
    amount: z.number().int().min(0).max(20),
    reason: z.string().min(1),
  })).max(5).optional().nullable(),
  enemyStatus: z.array(enemyTargetSchema.extend({
    status: z.enum(ENCOUNTER_ENEMY_STATUSES),
    reason: z.string().min(1),
  })).max(5).optional().nullable(),
  revealWeakness: z.array(enemyTargetSchema.extend({
    label: z.string().min(1),
  })).max(5).optional().nullable(),
  breakWeakness: z.array(enemyTargetSchema.extend({
    label: z.string().min(1),
  })).max(5).optional().nullable(),
  addEffect: z.array(enemyTargetSchema.extend({
    effect: encounterEffectProposalSchema,
  })).max(5).optional().nullable(),
  removeEffect: z.array(enemyTargetSchema.extend({
    effectName: z.string().min(1),
  })).max(5).optional().nullable(),
  areaUpdate: z.array(z.object({
    areaId: z.string().optional().nullable(),
    label: z.string().min(1),
    description: z.string().optional().nullable(),
    tags: z.array(z.string().min(1)).max(5).optional().nullable(),
  })).max(4).optional().nullable(),
}).optional().nullable();

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

const buffStatBonusesSchema = z.object({
  might: z.number().optional().nullable(),
  magic: z.number().optional().nullable(),
  mischief: z.number().optional().nullable(),
}).optional().nullable();

const buffAddSchema = z.object({
  characterName: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  kind: z.enum(['buff', 'curse']).optional().nullable(),
  statBonuses: buffStatBonusesSchema,
  remainingTurns: z.number().int().min(1).max(99).optional().nullable(),
  remainingUses: z.number().int().min(1).max(99).optional().nullable(),
  sourceCharacterName: z.string().min(1).optional().nullable(),
});

const buffRemoveSchema = z.object({
  characterName: z.string().min(1),
  buffName: z.string().min(1),
});

export const narrationOutputSchema = z.object({
  rollNarration: z.string().optional().nullable(),
  narration: z.string().min(1),
  choices: z.array(choiceSchema).length(3),
  currentTensionLevel: z.enum(TENSION_LEVEL_VALUES).default('medium'),
  suggestedInventoryAdd: inventoryAddSchema.optional().nullable(),
  suggestedInventoryRemove: inventoryRemoveSchema.optional().nullable(),
  suggestedInventoryUpdate: inventoryUpdateSchema.optional().nullable(),
  suggestedRevive: reviveSchema.optional().nullable(),
  suggestedHeal: z.array(reviveSchema).optional().nullable(),
  suggestedBuffAdd: z.preprocess(val => (val !== null && val !== undefined && !Array.isArray(val) ? [val] : val), z.array(buffAddSchema).optional().nullable()),
  suggestedBuffRemove: buffRemoveSchema.optional().nullable(),
  suggestedDamage: z.number().int().min(0).max(20).optional().nullable(),
  suggestedEncounterStart: suggestedEncounterStartSchema.optional().nullable(),
  suggestedEncounterUpdate: suggestedEncounterUpdateSchema,
});

export type ValidNarrationOutput = z.infer<typeof narrationOutputSchema>;
export type { EncounterStartProposal };
export type EncounterUpdateProposal = NonNullable<z.infer<typeof suggestedEncounterUpdateSchema>>;

export const NARRATION_FALLBACK: ValidNarrationOutput = {
  narration: 'The situation grows more mysterious, but the adventure continues.',
  choices: [
    { label: 'Inspect the area', difficulty: 'easy', stat: 'might', difficultyValue: 8, narration: 'You examine your surroundings carefully.' },
    { label: 'Talk to someone nearby', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, narration: 'Perhaps someone here knows more than they are letting on.' },
    { label: 'Use your magic', difficulty: 'normal', stat: 'magic', difficultyValue: 12, narration: 'Channel the arcane to reveal what lies hidden.' },
  ],
  currentTensionLevel: 'medium',
  suggestedInventoryAdd: null,
  suggestedInventoryRemove: null,
  suggestedInventoryUpdate: null,
  suggestedRevive: null,
  suggestedHeal: null,
  suggestedBuffAdd: null,
  suggestedBuffRemove: null,
  suggestedDamage: null,
  suggestedEncounterStart: null,
  suggestedEncounterUpdate: null,
};
