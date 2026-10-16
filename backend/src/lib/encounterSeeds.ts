import { z } from 'zod';
import type { EncounterSeed } from '../types.js';

// Encounter seeds come from AI or player-written DM Prep JSON and are checked on every
// turn. One shape check, used where seeds are parsed and where stored seeds are read,
// so no consumer ever sees a seed without a name, enemies or areas list.

const MAX_SEEDS = 4;

const SCHOOLS = ['fire', 'frost', 'light', 'shadow', 'nature', 'storm', 'mind', 'force', 'holy', 'mechanical'] as const;

const name = z.string().trim().min(1);

const seedSchema = z.object({
  name,
  triggerHint: z.string().default(''),
  enemies: z.array(z.object({
    name,
    role: z.enum(['minion', 'standard', 'elite', 'boss', 'hazard']),
    weaknesses: z.array(z.object({ label: name, school: z.enum(SCHOOLS).optional() })).optional(),
    traits: z.array(z.string()).optional(),
    avatarUrl: z.string().optional(),
  })).min(1),
  // The brief prompt tells the model to omit empty keys, so "no areas" arrives as no key.
  areas: z.array(z.object({
    label: name,
    tags: z.array(z.string()).default([]),
    effect: z.string().optional(),
    imageUrl: z.string().optional(),
  })).default([]),
  objective: z.string().optional(),
  lootHint: z.string().optional(),
}) satisfies z.ZodType<EncounterSeed, unknown>;

// Valid seeds (at most 4), dropping malformed ones; null when none are usable.
export const normalizeEncounterSeeds = (raw: unknown): EncounterSeed[] | null => {
  if (!Array.isArray(raw)) {
    return null;
  }
  const seeds = raw.flatMap(candidate => {
    const parsed = seedSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
  if (seeds.length < raw.length) {
    console.warn(`[EncounterSeeds] Dropped ${raw.length - seeds.length} malformed seed(s)`);
  }
  return seeds.length > 0 ? seeds.slice(0, MAX_SEEDS) : null;
};
