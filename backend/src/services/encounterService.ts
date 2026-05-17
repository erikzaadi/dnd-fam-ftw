import { createId } from '../lib/ids.js';
import type { Choice, EncounterArea, EncounterEnemy, EncounterSeed, EncounterState, Impact, Stat, TensionLevel } from '../types.js';
import type { EncounterStartProposal, EncounterUpdateProposal } from '../providers/ai/narration/narrationSchemas.js';

// HP bands by role (midpoint of range)
const HP_BY_ROLE: Record<EncounterEnemy['role'], number> = {
  minion: 2,
  standard: 6,
  elite: 11,
  boss: 20,
  hazard: 0,
};

const HP_MAX_BY_ROLE: Record<EncounterEnemy['role'], [number, number]> = {
  minion: [1, 3],
  standard: [4, 8],
  elite: [9, 14],
  boss: [15, 24],
  hazard: [0, 6],
};

const LEADING_ARTICLES = /^(a |an |the )/i;
const STRIP_PUNCT = /[^a-z0-9\s]/g;

export const normalizeEnemyName = (name: string): string =>
  name.trim().toLowerCase().replace(LEADING_ARTICLES, '').replace(STRIP_PUNCT, '').replace(/\s+/g, ' ').trim();

const normalizeEncounterName = (name: string): string =>
  name.trim().toLowerCase().replace(LEADING_ARTICLES, '').replace(STRIP_PUNCT, '').replace(/\s+/g, ' ').trim();

const containsNormalizedTerm = (text: string, term: string): boolean => {
  const normalizedText = normalizeEncounterName(text);
  const normalizedTerm = normalizeEncounterName(term);
  if (!normalizedTerm) {
    return false;
  }
  return normalizedText.includes(normalizedTerm);
};

// Generate aliases from a name: words of 4+ chars as additional short forms
const buildAliases = (name: string): string[] => {
  const normalized = normalizeEnemyName(name);
  const words = normalized.split(' ').filter(w => w.length >= 4);
  const aliases = [...new Set([normalized, ...words])];
  return aliases.filter(a => a !== normalized).slice(0, 3);
};

const clampHp = (role: EncounterEnemy['role']): number => {
  const [min, max] = HP_MAX_BY_ROLE[role];
  return HP_BY_ROLE[role] < min ? min : HP_BY_ROLE[role] > max ? max : HP_BY_ROLE[role];
};

const buildEnemyFromProposal = (
  e: EncounterStartProposal['enemies'][number],
): EncounterEnemy => {
  const hp = clampHp(e.role);
  return {
    id: createId(),
    name: e.name,
    aliases: buildAliases(e.name),
    role: e.role,
    hp,
    maxHp: hp,
    traits: e.traits?.filter(Boolean) ?? undefined,
    weaknesses: (e.weaknesses ?? []).map(w => ({
      id: createId(),
      label: w.label,
      school: w.school ?? undefined,
      revealed: false,
    })),
    status: 'active',
  };
};

const buildAreaFromProposal = (a: { label: string; description?: string | null; tags?: string[] | null }): EncounterArea => ({
  id: createId(),
  label: a.label,
  description: a.description ?? '',
  tags: a.tags?.filter(Boolean) ?? [],
});

// Match proposed encounter name against stored seeds
export const resolveEncounterSeed = (
  proposedName: string,
  seeds: EncounterSeed[],
): EncounterSeed | null => {
  const normalized = normalizeEncounterName(proposedName);
  return seeds.find(s => normalizeEncounterName(s.name) === normalized) ?? null;
};

// Hydrate an EncounterState from a seed, merging AI proposal details
const hydrateFromSeed = (
  seed: EncounterSeed,
  proposal: EncounterStartProposal,
): EncounterState => {
  const enemies: EncounterEnemy[] = seed.enemies.map(se => {
    const matching = proposal.enemies.find(pe =>
      normalizeEnemyName(pe.name) === normalizeEnemyName(se.name)
    );
    const hp = clampHp(se.role);
    return {
      id: createId(),
      name: se.name,
      aliases: buildAliases(se.name),
      role: se.role,
      hp,
      maxHp: hp,
      traits: se.traits?.filter(Boolean) ?? undefined,
      weaknesses: (se.weaknesses ?? []).map(w => ({
        id: createId(),
        label: w.label,
        school: w.school ?? undefined,
        revealed: false,
      })),
      // Merge any extra weaknesses from the AI proposal that aren't in the seed
      ...(() => {
        const seedLabels = new Set((se.weaknesses ?? []).map(w => w.label.toLowerCase()));
        const extraWeaknesses = (matching?.weaknesses ?? [])
          .filter(pw => !seedLabels.has(pw.label.toLowerCase()))
          .map(pw => ({
            id: createId(),
            label: pw.label,
            school: pw.school ?? undefined,
            revealed: false,
          }));
        if (extraWeaknesses.length > 0) {
          return {
            weaknesses: [
              ...(se.weaknesses ?? []).map(w => ({ id: createId(), label: w.label, school: w.school ?? undefined, revealed: false })),
              ...extraWeaknesses,
            ],
          };
        }
        return {};
      })(),
      status: 'active',
      ...(se.avatarUrl && { avatarUrl: se.avatarUrl }),
    };
  });

  const areas: EncounterArea[] = (seed.areas ?? []).map(a => {
    const proposalArea = proposal.areas?.find(pa => pa.label.toLowerCase() === a.label.toLowerCase());
    return {
      id: createId(),
      label: a.label,
      description: proposalArea?.description ?? '',
      tags: a.tags?.filter(Boolean) ?? [],
      ...(a.effect && { effect: a.effect }),
      ...(a.imageUrl && { imageUrl: a.imageUrl }),
    };
  });

  // Merge any extra areas from proposal not in seed
  const seedAreaLabels = new Set(areas.map(a => a.label.toLowerCase()));
  for (const pa of proposal.areas ?? []) {
    if (!seedAreaLabels.has(pa.label.toLowerCase())) {
      areas.push(buildAreaFromProposal(pa));
    }
  }

  return {
    id: createId(),
    name: seed.name,
    status: 'active',
    enemies,
    areas,
    round: 1,
    objective: proposal.objective ?? seed.objective,
  };
};

// Create encounter purely from AI proposal (no seed match)
const createFromProposal = (proposal: EncounterStartProposal): EncounterState => ({
  id: createId(),
  name: proposal.name,
  status: 'active',
  enemies: proposal.enemies.slice(0, 3).map(buildEnemyFromProposal),
  areas: (proposal.areas ?? []).slice(0, 4).map(buildAreaFromProposal),
  round: 1,
  objective: proposal.objective ?? undefined,
});

const proposalFromSeed = (seed: EncounterSeed): EncounterStartProposal => ({
  name: seed.name,
  enemies: seed.enemies.map(enemy => ({
    name: enemy.name,
    role: enemy.role,
    traits: enemy.traits ?? null,
    weaknesses: enemy.weaknesses ?? null,
  })),
  areas: seed.areas.map(area => ({
    label: area.label,
    tags: area.tags,
  })),
  objective: seed.objective ?? null,
});

export const inferSeededEncounterStart = (
  input: {
    narration?: string | null;
    imagePrompt?: string | null;
    choices?: Choice[] | null;
    actionAttempt?: string | null;
    currentTensionLevel?: TensionLevel | null;
    suggestedDamage?: number | null;
  },
  seeds: EncounterSeed[] | undefined,
  currentEncounter: EncounterState | undefined,
): EncounterStartProposal | null => {
  if (currentEncounter?.status === 'active' || !seeds?.length) {
    return null;
  }

  const hasHighDanger = input.currentTensionLevel === 'high' || (typeof input.suggestedDamage === 'number' && input.suggestedDamage > 0);
  const hasMediumDanger = input.currentTensionLevel === 'medium';
  if (!hasHighDanger && !hasMediumDanger) {
    return null;
  }

  const choiceText = (input.choices ?? [])
    .map(choice => `${choice.label} ${choice.narration ?? ''} ${choice.environmentFeature ?? ''}`)
    .join(' ');
  const haystack = [
    input.narration ?? '',
    input.imagePrompt ?? '',
    input.actionAttempt ?? '',
    choiceText,
  ].join(' ');

  const seed = seeds.find(candidate => {
    if (candidate.enemies.length === 0) {
      return false;
    }
    // Don't re-start an encounter whose name matches the one just resolved.
    // The victory narration always mentions the defeated enemies, which would
    // otherwise immediately re-trigger the same encounter seed.
    if (
      currentEncounter &&
      currentEncounter.status !== 'active' &&
      normalizeEncounterName(candidate.name) === normalizeEncounterName(currentEncounter.name)
    ) {
      return false;
    }
    const seedNameMatch = containsNormalizedTerm(haystack, candidate.name);
    const enemyNameMatch = candidate.enemies.some(enemy => containsNormalizedTerm(haystack, enemy.name));
    if (hasHighDanger) {
      return seedNameMatch || enemyNameMatch;
    }
    // At medium danger, only trigger on a direct seed-name match to avoid
    // false positives from ambient enemy mentions in non-combat narration.
    return seedNameMatch;
  });

  return seed ? proposalFromSeed(seed) : null;
};

// Main entry point for handling suggestedEncounterStart
export const handleEncounterStart = (
  proposal: EncounterStartProposal,
  seeds: EncounterSeed[] | undefined,
  currentEncounter: EncounterState | undefined,
  pastEncounters?: EncounterState[],
): EncounterState | null => {
  // Don't start a new encounter if one is already active
  if (currentEncounter?.status === 'active') {
    return null;
  }

  // Block re-spawning an encounter whose enemies were all already defeated recently
  if (pastEncounters && pastEncounters.length > 0) {
    const recentDefeatedNames = new Set(
      pastEncounters.slice(-5).flatMap(enc => enc.enemies.map(e => normalizeEnemyName(e.name)))
    );
    if (proposal.enemies.every(e => recentDefeatedNames.has(normalizeEnemyName(e.name)))) {
      return null;
    }
  }

  const seed = seeds ? resolveEncounterSeed(proposal.name, seeds) : null;

  if (!seed) {
    const bossCount = proposal.enemies.filter(e => e.role === 'boss').length;
    if (bossCount > 0) {
      console.warn(`[EncounterService] Organic encounter "${proposal.name}" proposed ${bossCount} boss enemy/enemies - downgrading to elite`);
      proposal = {
        ...proposal,
        enemies: proposal.enemies.map(e => e.role === 'boss' ? { ...e, role: 'elite' } : e),
      };
    }
  }

  const encounter = seed ? hydrateFromSeed(seed, proposal) : createFromProposal(proposal);

  // Guard: max 3 enemies on creation
  encounter.enemies = encounter.enemies.slice(0, 3);
  return encounter;
};

// Resolve an enemy from an encounter by id or normalized name/alias
export const resolveEnemy = (
  encounter: EncounterState,
  enemyId: string | null | undefined,
  enemyName: string | null | undefined,
): EncounterEnemy | null => {
  if (enemyId) {
    const byId = encounter.enemies.find(e => e.id === enemyId);
    if (byId) {
      return byId;
    }
  }
  if (!enemyName) {
    return null;
  }
  const normalized = normalizeEnemyName(enemyName);
  const matches = encounter.enemies.filter(e => {
    if (normalizeEnemyName(e.name) === normalized) {
      return true;
    }
    return (e.aliases ?? []).some(a => a === normalized);
  });
  // Reject ambiguous matches
  return matches.length === 1 ? matches[0] : null;
};

// Apply a suggestedEncounterUpdate to an active encounter state (mutates a deep clone)
export const applyEncounterUpdate = (
  encounter: EncounterState,
  update: EncounterUpdateProposal,
): EncounterState => {
  const next: EncounterState = JSON.parse(JSON.stringify(encounter));

  // Enemy damage
  for (const dmg of update.enemyDamage ?? []) {
    const enemy = resolveEnemy(next, dmg.enemyId, dmg.enemyName);
    if (!enemy || enemy.status !== 'active') {
      continue;
    }
    const amount = Math.max(0, Math.round(dmg.amount));
    enemy.hp = Math.max(0, enemy.hp - amount);
    if (enemy.hp === 0) {
      enemy.status = 'defeated';
    }
  }

  // Enemy status overrides (cannot resurrect defeated)
  for (const es of update.enemyStatus ?? []) {
    const enemy = resolveEnemy(next, es.enemyId, es.enemyName);
    if (!enemy || enemy.status === 'defeated') {
      continue;
    }
    enemy.status = es.status;
    enemy.hp = 0;
  }

  // Reveal weakness
  for (const rw of update.revealWeakness ?? []) {
    const enemy = resolveEnemy(next, rw.enemyId, rw.enemyName);
    if (!enemy) {
      continue;
    }
    const weakness = (enemy.weaknesses ?? []).find(
      w => w.label.toLowerCase() === rw.label.toLowerCase(),
    );
    if (weakness) {
      weakness.revealed = true;
    }
  }

  // Break weakness (reveal + mark as broken)
  for (const bw of update.breakWeakness ?? []) {
    const enemy = resolveEnemy(next, bw.enemyId, bw.enemyName);
    if (!enemy) {
      continue;
    }
    const weakness = (enemy.weaknesses ?? []).find(
      w => w.label.toLowerCase() === bw.label.toLowerCase(),
    );
    if (weakness) {
      weakness.revealed = true;
      weakness.broken = true;
    }
  }

  // Add effect to enemy
  for (const ae of update.addEffect ?? []) {
    const enemy = resolveEnemy(next, ae.enemyId, ae.enemyName);
    if (!enemy || enemy.status !== 'active') {
      continue;
    }
    const effect = ae.effect;
    enemy.effects = enemy.effects ?? [];
    const existing = enemy.effects.find(
      ef => ef.name.toLowerCase() === effect.name.toLowerCase(),
    );
    if (existing) {
      // Refresh duration
      if (typeof effect.remainingTurns === 'number') {
        existing.remainingTurns = effect.remainingTurns;
      }
    } else {
      enemy.effects.push({
        id: createId(),
        name: effect.name,
        description: effect.description,
        kind: effect.kind,
        damagePerTurn: effect.damagePerTurn ?? undefined,
        remainingTurns: effect.remainingTurns ?? undefined,
        statBonuses: effect.statBonuses
          ? {
            might: effect.statBonuses.might ?? undefined,
            magic: effect.statBonuses.magic ?? undefined,
            mischief: effect.statBonuses.mischief ?? undefined,
          }
          : undefined,
      });
    }
  }

  // Remove effect from enemy
  for (const re of update.removeEffect ?? []) {
    const enemy = resolveEnemy(next, re.enemyId, re.enemyName);
    if (!enemy) {
      continue;
    }
    enemy.effects = (enemy.effects ?? []).filter(
      ef => ef.name.toLowerCase() !== re.effectName.toLowerCase(),
    );
  }

  // Area updates (add or update by label)
  for (const au of update.areaUpdate ?? []) {
    const existing = next.areas.find(a =>
      (au.areaId && a.id === au.areaId) || a.label.toLowerCase() === au.label.toLowerCase(),
    );
    if (existing) {
      if (au.description != null) {
        existing.description = au.description;
      }
      if (au.tags != null) {
        existing.tags = au.tags.filter(Boolean);
      }
    } else {
      next.areas.push({
        id: createId(),
        label: au.label,
        description: au.description ?? '',
        tags: au.tags?.filter(Boolean) ?? [],
      });
    }
  }

  // Tick damage-over-time effects
  for (const enemy of next.enemies) {
    if (enemy.status !== 'active' || !enemy.effects?.length) {
      continue;
    }
    for (const effect of enemy.effects) {
      if (typeof effect.damagePerTurn === 'number' && effect.damagePerTurn > 0) {
        enemy.hp = Math.max(0, enemy.hp - effect.damagePerTurn);
        if (enemy.hp === 0) {
          enemy.status = 'defeated';
        }
      }
      if (typeof effect.remainingTurns === 'number') {
        effect.remainingTurns = Math.max(0, effect.remainingTurns - 1);
      }
    }
    enemy.effects = enemy.effects.filter(ef => (ef.remainingTurns ?? 1) > 0);
  }

  next.round += 1;

  // Check if all enemies are resolved
  const allResolved = next.enemies.every(e => e.status !== 'active');
  if (allResolved && next.status === 'active') {
    const hasFled = next.enemies.some(e => e.status === 'fled');
    const hasSurrendered = next.enemies.some(e => e.status === 'surrendered');
    next.status = hasFled ? 'fled' : hasSurrendered ? 'surrendered' : 'defeated';
    next.lastResolvedEnemyName = next.enemies.find(e => e.status !== 'active')?.name;
  }

  return next;
};

// Map action impact to base enemy damage
export const computeImpactDamage = (impact: Impact | undefined): number => {
  if (impact === 'extreme') {
    return 5;
  }
  if (impact === 'strong') {
    return 3;
  }
  return 2;
};

// Apply weakness/resistance modifiers to base damage for a given stat
export const computeEnemyDamage = (
  enemy: EncounterEnemy,
  baseDamage: number,
  statUsed: Stat | 'none',
): number => {
  if (statUsed === 'none') {
    return baseDamage;
  }

  const weakness = (enemy.weaknesses ?? []).find(
    w => w.revealed && !w.broken && w.stat === statUsed,
  );
  if (weakness) {
    const multiplier = weakness.damageMultiplier ?? 1;
    const bonus = weakness.bonusDamage ?? 1;
    return Math.round(baseDamage * multiplier) + bonus;
  }

  const resistance = (enemy.resistances ?? []).find(r => r.stat === statUsed);
  if (resistance) {
    return Math.max(1, Math.round(baseDamage * resistance.damageMultiplier));
  }

  return baseDamage;
};

// Derive hp label from HP ratio
export const getEnemyHpLabel = (enemy: EncounterEnemy): string => {
  if (enemy.status !== 'active' || enemy.hp === 0) {
    return 'defeated';
  }
  const ratio = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 0;
  if (ratio > 0.75) {
    return 'fresh';
  }
  if (ratio > 0.5) {
    return 'wounded';
  }
  if (ratio > 0.25) {
    return 'staggering';
  }
  return 'nearly broken';
};
