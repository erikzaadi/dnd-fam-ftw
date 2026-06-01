import { z } from 'zod';
import { TENSION_LEVEL_VALUES } from '../../../types.js';
import {
  choiceSchema,
  inventoryAddSchema,
  inventoryRemoveSchema,
  inventoryUpdateSchema,
  reviveSchema,
  buffAddSchema,
  buffRemoveSchema,
  suggestedEncounterStartSchema,
  suggestedEncounterUpdateSchema,
} from './narrationSchemas.js';

export const narrationAgentOutputSchema = z.object({
  rollNarration: z.string().optional().nullable(),
  narration: z.string().min(1),
  currentTensionLevel: z.enum(TENSION_LEVEL_VALUES).default('medium'),
});

export type NarrationAgentOutput = z.infer<typeof narrationAgentOutputSchema>;

export const choicesAgentOutputSchema = z.object({
  choices: z.array(choiceSchema).length(3),
});

export type ChoicesAgentOutput = z.infer<typeof choicesAgentOutputSchema>;

export const combatAgentOutputSchema = z.object({
  suggestedDamage: z.number().int().min(0).max(20).optional().nullable(),
  suggestedEncounterStart: suggestedEncounterStartSchema.optional().nullable(),
  suggestedEncounterUpdate: suggestedEncounterUpdateSchema,
});

export type CombatAgentOutput = z.infer<typeof combatAgentOutputSchema>;

export const inventoryAgentOutputSchema = z.object({
  suggestedInventoryAdd: inventoryAddSchema.optional().nullable(),
  suggestedInventoryRemove: inventoryRemoveSchema.optional().nullable(),
  suggestedInventoryUpdate: inventoryUpdateSchema.optional().nullable(),
});

export type InventoryAgentOutput = z.infer<typeof inventoryAgentOutputSchema>;

export const recoveryAgentOutputSchema = z.object({
  suggestedRevive: reviveSchema.optional().nullable(),
  suggestedHeal: z.array(reviveSchema).optional().nullable(),
  suggestedBuffAdd: z.preprocess(
    val => (val !== null && val !== undefined && !Array.isArray(val) ? [val] : val),
    z.array(buffAddSchema).optional().nullable(),
  ),
  suggestedBuffRemove: buffRemoveSchema.optional().nullable(),
});

export type RecoveryAgentOutput = z.infer<typeof recoveryAgentOutputSchema>;
