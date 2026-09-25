import { z } from 'zod';
import { OBJECTIVE_OUTCOME_VALUES, TENSION_LEVEL_VALUES } from '../../../types.js';
import type { AgentErrorKind, AgentDiagnostic } from '@dnd-fam-ftw/shared';

export type { AgentErrorKind, AgentDiagnostic };
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

// Agent field ownership contract
// Each agent owns exactly the fields listed below and must not emit fields from another agent's column.
// Prompts must not instruct an agent to set a field outside its owned set.
// Tests enforce this by asserting forbidden field names are absent from each compiled agent system prompt.
//
// Agent      | Owns                                                                          | Must Not Own
// -----------|-------------------------------------------------------------------------------|---------------------------------------------
// Narration  | rollNarration, narration, currentTensionLevel, objectiveOutcome, posesRiddle, | choices, inventory, HP, buffs, encounter mutation
//            | riddle                                                                        |
// Choices    | choices                                                                       | narration, inventory, HP, buffs, encounter mutation
// Combat     | suggestedDamage, suggestedEncounterStart, suggestedEncounterUpdate            | narration, choices, inventory, HP healing, buffs
// Inventory  | suggestedInventoryAdd, suggestedInventoryRemove, suggestedInventoryUpdate     | narration, choices, HP, buffs, encounter mutation
// Recovery   | suggestedRevive, suggestedHeal, suggestedBuffAdd, suggestedBuffRemove         | narration, choices, inventory, encounter mutation


export const narrationAgentOutputSchema = z.object({
  rollNarration: z.string().optional().nullable(),
  narration: z.string().min(1),
  currentTensionLevel: z.enum(TENSION_LEVEL_VALUES).default('medium'),
  // Proposal only: the server accepts a resolution when committed facts support it.
  objectiveOutcome: z.enum(OBJECTIVE_OUTCOME_VALUES).optional().nullable(),
  // True when this turn's narration poses a riddle, password, or answerable puzzle.
  posesRiddle: z.boolean().optional().nullable(),
  // The authoritative answer to that riddle. Server-only: never shown to players.
  riddle: z.object({
    prompt: z.string().max(300).optional().nullable(),
    canonicalAnswer: z.string().min(1).max(80),
    aliases: z.array(z.string().min(1).max(80)).max(6).optional().nullable(),
  }).optional().nullable(),
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
