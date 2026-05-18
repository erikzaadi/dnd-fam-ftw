import { describe, it, expect } from 'vitest';
import {
  normalizeEnemyName,
  resolveEncounterSeed,
  handleEncounterStart,
  inferOrganicEncounterStart,
  resolveEnemy,
  applyEncounterUpdate,
  getEnemyHpLabel,
  computeImpactDamage,
  computeEnemyDamage,
} from './encounterService.js';
import type { EncounterEnemy, EncounterSeed, EncounterState } from '../types.js';

const THORN_SEED: EncounterSeed = {
  name: 'Thornwood Guardian',
  triggerHint: 'when party enters the Thornwood',
  enemies: [
    { name: 'Vine Beast', role: 'standard', weaknesses: [{ label: 'dry thornwood sap', school: 'fire' }], traits: ['regenerates'] },
  ],
  areas: [{ label: 'Writhing Roots', tags: ['hazard'] }],
  objective: 'Defeat the guardian',
  lootHint: 'a thornwood key',
};

const SHADOW_SEED: EncounterSeed = {
  name: 'Shadow Ambush',
  triggerHint: 'entering the dark alley',
  enemies: [
    { name: 'Shadow Wraith', role: 'elite', weaknesses: [{ label: 'old oath', school: 'holy' }] },
  ],
  areas: [{ label: 'Dark Alley', tags: ['hazard', 'shadow'] }],
};

const SEEDS = [THORN_SEED, SHADOW_SEED];

describe('normalizeEnemyName', () => {
  it('lowercases and strips leading articles', () => {
    expect(normalizeEnemyName('The Shadow Wraith')).toBe('shadow wraith');
    expect(normalizeEnemyName('A Vine Beast')).toBe('vine beast');
    expect(normalizeEnemyName('An Ancient Guardian')).toBe('ancient guardian');
  });

  it('strips punctuation', () => {
    expect(normalizeEnemyName("The Giant's Fist")).toBe('giants fist');
  });
});

describe('resolveEncounterSeed', () => {
  it('matches exact name (case-insensitive)', () => {
    expect(resolveEncounterSeed('thornwood guardian', SEEDS)).toBe(THORN_SEED);
    expect(resolveEncounterSeed('THORNWOOD GUARDIAN', SEEDS)).toBe(THORN_SEED);
  });

  it('matches after stripping leading article', () => {
    expect(resolveEncounterSeed('The Shadow Ambush', SEEDS)).toBe(SHADOW_SEED);
  });

  it('returns null for unknown names', () => {
    expect(resolveEncounterSeed('Dragon Horde', SEEDS)).toBeNull();
  });

  it('returns null for ambiguous partial matches', () => {
    // "Shadow" should not match "Shadow Ambush" since it's not an exact normalized match
    expect(resolveEncounterSeed('Shadow', SEEDS)).toBeNull();
  });
});

describe('handleEncounterStart', () => {
  const PROPOSAL = {
    name: 'Thornwood Guardian',
    enemies: [{ name: 'Vine Beast', role: 'standard' as const, weaknesses: [{ label: 'dry thornwood sap', school: 'fire' as const }] }],
    areas: [{ label: 'Writhing Roots', description: 'Tangled roots', tags: ['hazard'] }],
    objective: 'Defeat the guardian',
  };

  it('hydrates from seed when name matches', () => {
    const enc = handleEncounterStart(PROPOSAL, SEEDS, undefined);
    expect(enc).not.toBeNull();
    expect(enc!.name).toBe('Thornwood Guardian');
    expect(enc!.enemies[0].name).toBe('Vine Beast');
    expect(enc!.enemies[0].role).toBe('standard');
    expect(enc!.status).toBe('active');
    expect(enc!.round).toBe(1);
  });

  it('assigns backend IDs to enemies and weaknesses', () => {
    const enc = handleEncounterStart(PROPOSAL, SEEDS, undefined);
    expect(enc!.enemies[0].id).toMatch(/^[a-f0-9]{12}$/);
    expect(enc!.enemies[0].weaknesses![0].id).toMatch(/^[a-f0-9]{12}$/);
  });

  it('clamps HP from role bands', () => {
    const enc = handleEncounterStart(PROPOSAL, SEEDS, undefined);
    expect(enc!.enemies[0].hp).toBeGreaterThanOrEqual(4);
    expect(enc!.enemies[0].hp).toBeLessThanOrEqual(8);
    expect(enc!.enemies[0].maxHp).toBe(enc!.enemies[0].hp);
  });

  it('creates from proposal when no seed matches', () => {
    const enc = handleEncounterStart(
      { name: 'Unknown Menace', enemies: [{ name: 'Goblin', role: 'minion' }] },
      SEEDS,
      undefined,
    );
    expect(enc).not.toBeNull();
    expect(enc!.name).toBe('Unknown Menace');
    expect(enc!.enemies[0].name).toBe('Goblin');
    expect(enc!.enemies[0].hp).toBeGreaterThanOrEqual(1);
    expect(enc!.enemies[0].hp).toBeLessThanOrEqual(3);
  });

  it('returns null when an active encounter already exists', () => {
    const activeEnc: EncounterState = {
      id: 'enc-existing',
      name: 'Existing',
      status: 'active',
      enemies: [],
      areas: [],
      round: 2,
    };
    expect(handleEncounterStart(PROPOSAL, SEEDS, activeEnc)).toBeNull();
  });

  it('allows start after previous encounter resolved', () => {
    const resolved: EncounterState = {
      id: 'enc-done',
      name: 'Old Fight',
      status: 'defeated',
      enemies: [],
      areas: [],
      round: 3,
    };
    expect(handleEncounterStart(PROPOSAL, SEEDS, resolved)).not.toBeNull();
  });

  it('caps enemies at 3 on creation', () => {
    const manyEnemies = {
      name: 'Goblin Horde',
      enemies: [
        { name: 'Goblin A', role: 'minion' as const },
        { name: 'Goblin B', role: 'minion' as const },
        { name: 'Goblin C', role: 'minion' as const },
        { name: 'Goblin D', role: 'minion' as const },
      ],
    };
    const enc = handleEncounterStart(manyEnemies, [], undefined);
    expect(enc!.enemies).toHaveLength(3);
  });

  it('does not reveal seed weaknesses by default', () => {
    const enc = handleEncounterStart(PROPOSAL, SEEDS, undefined);
    expect(enc!.enemies[0].weaknesses![0].revealed).toBe(false);
  });

  it('preserves seed traits', () => {
    const enc = handleEncounterStart(PROPOSAL, SEEDS, undefined);
    expect(enc!.enemies[0].traits).toContain('regenerates');
  });

  it('preserves boss role for seeded encounters', () => {
    const bossSeed: EncounterSeed = {
      name: 'Dragon Lord',
      triggerHint: 'entering the throne room',
      enemies: [{ name: 'Dragon Lord', role: 'boss', weaknesses: [] }],
      areas: [{ label: 'Throne Room', tags: [] }],
    };
    const enc = handleEncounterStart(
      { name: 'Dragon Lord', enemies: [{ name: 'Dragon Lord', role: 'boss' }] },
      [bossSeed],
      undefined,
    );
    expect(enc!.enemies[0].role).toBe('boss');
  });

  it('downgrades boss to elite for organic (seedless) encounters', () => {
    const enc = handleEncounterStart(
      { name: 'Mystery Threat', enemies: [{ name: 'Dark Lord', role: 'boss' }] },
      SEEDS,
      undefined,
    );
    expect(enc!.enemies[0].role).toBe('elite');
  });
});

describe('inferOrganicEncounterStart', () => {
  it('creates a small organic encounter from high-danger combat narration', () => {
    const proposal = inferOrganicEncounterStart({
      narration: 'A bandit springs from behind the cracked pillar and attacks.',
      currentTensionLevel: 'high',
      suggestedDamage: 1,
    }, undefined);

    expect(proposal?.name).toBe('Bandit Skirmish');
    expect(proposal?.enemies[0].name).toBe('Bandit');
    expect(proposal?.enemies[0].role).toBe('standard');
  });

  it('does not infer from atmospheric tension alone', () => {
    const proposal = inferOrganicEncounterStart({
      narration: 'The hallway grows colder as distant bells echo.',
      currentTensionLevel: 'high',
    }, undefined);

    expect(proposal).toBeNull();
  });

  it('does not infer from next-turn combat choices or a looming shadow alone', () => {
    const proposal = inferOrganicEncounterStart({
      narration: "Outside, Vesperine Quill's shadow looms in the distance, her quill poised for a final stroke.",
      imagePrompt: 'Dragonborn bard Durogg stands outside a crumbling basilica, wild magic crackling nearby, tension in the air.',
      actionAttempt: 'Rinsworth swiftly chants a teleportation spell, aiming to whisk the team outside the crumbling basilica.',
      choices: [
        { label: 'Confront Vesperine with a defiant battle song', difficulty: 'normal', stat: 'mischief' },
        { label: "Examine the unstable rune's lingering energy for a containment clue", difficulty: 'hard', stat: 'magic' },
      ],
      currentTensionLevel: 'high',
    }, undefined);

    expect(proposal).toBeNull();
  });

  it('does not infer while an encounter is active', () => {
    const activeEnc: EncounterState = {
      id: 'enc-existing',
      name: 'Existing',
      status: 'active',
      enemies: [],
      areas: [],
      round: 2,
    };
    const proposal = inferOrganicEncounterStart({
      narration: 'A bandit springs from behind the cracked pillar and attacks.',
      currentTensionLevel: 'high',
      suggestedDamage: 1,
    }, activeEnc);

    expect(proposal).toBeNull();
  });
});

describe('resolveEnemy', () => {
  const enc: EncounterState = {
    id: 'e1',
    name: 'Fight',
    status: 'active',
    round: 1,
    enemies: [
      { id: 'enemy-001', name: 'Vine Beast', role: 'standard', hp: 6, maxHp: 6, status: 'active', aliases: ['vine beast', 'beast'] },
      { id: 'enemy-002', name: 'Shadow Wraith', role: 'elite', hp: 11, maxHp: 11, status: 'active', aliases: ['shadow wraith', 'wraith'] },
    ],
    areas: [],
  };

  it('resolves by exact id', () => {
    expect(resolveEnemy(enc, 'enemy-001', null)?.name).toBe('Vine Beast');
  });

  it('resolves by normalized name', () => {
    expect(resolveEnemy(enc, null, 'Vine Beast')?.id).toBe('enemy-001');
    expect(resolveEnemy(enc, null, 'the vine beast')?.id).toBe('enemy-001');
  });

  it('resolves by alias', () => {
    expect(resolveEnemy(enc, null, 'wraith')?.id).toBe('enemy-002');
  });

  it('returns null for unknown names', () => {
    expect(resolveEnemy(enc, null, 'Goblin')).toBeNull();
  });

  it('returns null when neither id nor name provided', () => {
    expect(resolveEnemy(enc, null, null)).toBeNull();
  });
});

describe('applyEncounterUpdate', () => {
  const makeEnc = (): EncounterState => ({
    id: 'enc-test',
    name: 'Test Fight',
    status: 'active',
    round: 1,
    enemies: [
      {
        id: 'e1',
        name: 'Vine Beast',
        role: 'standard',
        hp: 6,
        maxHp: 6,
        status: 'active',
        weaknesses: [{ id: 'w1', label: 'dry thornwood sap', school: 'fire', revealed: false }],
        aliases: ['vine beast'],
      },
    ],
    areas: [{ id: 'a1', label: 'Roots', description: 'Tangled', tags: ['hazard'] }],
  });

  it('applies enemy damage', () => {
    const result = applyEncounterUpdate(makeEnc(), {
      enemyDamage: [{ enemyName: 'Vine Beast', amount: 3, reason: 'fire attack' }],
    });
    expect(result.enemies[0].hp).toBe(3);
  });

  it('defeats enemy when damage exceeds HP', () => {
    const result = applyEncounterUpdate(makeEnc(), {
      enemyDamage: [{ enemyName: 'Vine Beast', amount: 10, reason: 'overwhelming fire' }],
    });
    expect(result.enemies[0].hp).toBe(0);
    expect(result.enemies[0].status).toBe('defeated');
  });

  it('marks encounter as defeated when all enemies fall', () => {
    const result = applyEncounterUpdate(makeEnc(), {
      enemyDamage: [{ enemyName: 'Vine Beast', amount: 6, reason: 'final blow' }],
    });
    expect(result.status).toBe('defeated');
  });

  it('reveals a weakness', () => {
    const result = applyEncounterUpdate(makeEnc(), {
      revealWeakness: [{ enemyName: 'Vine Beast', label: 'dry thornwood sap' }],
    });
    expect(result.enemies[0].weaknesses![0].revealed).toBe(true);
  });

  it('sets enemy status to fled', () => {
    const result = applyEncounterUpdate(makeEnc(), {
      enemyStatus: [{ enemyName: 'Vine Beast', status: 'fled', reason: 'scared away' }],
    });
    expect(result.enemies[0].status).toBe('fled');
    expect(result.status).toBe('fled');
  });

  it('does not change a defeated enemy via enemyStatus', () => {
    const enc = makeEnc();
    enc.enemies[0].status = 'defeated';
    enc.enemies[0].hp = 0;
    const result = applyEncounterUpdate(enc, {
      enemyStatus: [{ enemyName: 'Vine Beast', status: 'fled', reason: 'too late' }],
    });
    expect(result.enemies[0].status).toBe('defeated');
  });

  it('adds an area', () => {
    const result = applyEncounterUpdate(makeEnc(), {
      areaUpdate: [{ label: 'Glowing Rune', description: 'Pulses with magic', tags: ['magic'] }],
    });
    expect(result.areas).toHaveLength(2);
    expect(result.areas[1].label).toBe('Glowing Rune');
  });

  it('updates an existing area by label', () => {
    const result = applyEncounterUpdate(makeEnc(), {
      areaUpdate: [{ label: 'Roots', description: 'Now on fire' }],
    });
    expect(result.areas).toHaveLength(1);
    expect(result.areas[0].description).toBe('Now on fire');
  });

  it('increments round counter', () => {
    const result = applyEncounterUpdate(makeEnc(), {});
    expect(result.round).toBe(2);
  });

  it('ignores damage to non-active enemies', () => {
    const enc = makeEnc();
    enc.enemies[0].status = 'defeated';
    enc.enemies[0].hp = 0;
    const result = applyEncounterUpdate(enc, {
      enemyDamage: [{ enemyName: 'Vine Beast', amount: 5, reason: 'overkill' }],
    });
    expect(result.enemies[0].hp).toBe(0);
  });
});

describe('getEnemyHpLabel', () => {
  const makeEnemy = (hp: number, maxHp: number, status: EncounterState['enemies'][0]['status'] = 'active') => ({
    id: 'e',
    name: 'Test',
    role: 'standard' as const,
    hp,
    maxHp,
    status,
  });

  it('returns fresh above 75%', () => {
    expect(getEnemyHpLabel(makeEnemy(6, 6))).toBe('fresh');
    expect(getEnemyHpLabel(makeEnemy(5, 6))).toBe('fresh');
  });

  it('returns wounded between 50-75%', () => {
    expect(getEnemyHpLabel(makeEnemy(4, 6))).toBe('wounded');
  });

  it('returns staggering between 25-50%', () => {
    expect(getEnemyHpLabel(makeEnemy(2, 6))).toBe('staggering');
  });

  it('returns nearly broken below 25%', () => {
    expect(getEnemyHpLabel(makeEnemy(1, 6))).toBe('nearly broken');
  });

  it('returns defeated for 0 hp', () => {
    expect(getEnemyHpLabel(makeEnemy(0, 6))).toBe('defeated');
  });

  it('returns defeated for non-active status', () => {
    expect(getEnemyHpLabel(makeEnemy(6, 6, 'fled'))).toBe('defeated');
  });
});

describe('computeImpactDamage', () => {
  it('returns 2 for normal impact', () => {
    expect(computeImpactDamage('normal')).toBe(2);
  });

  it('returns 3 for strong impact', () => {
    expect(computeImpactDamage('strong')).toBe(3);
  });

  it('returns 5 for extreme impact', () => {
    expect(computeImpactDamage('extreme')).toBe(5);
  });

  it('returns 2 for undefined impact', () => {
    expect(computeImpactDamage(undefined)).toBe(2);
  });
});

describe('computeEnemyDamage', () => {
  const makeTestEnemy = (overrides: Partial<EncounterEnemy> = {}): EncounterEnemy => ({
    id: 'e1',
    name: 'Vine Beast',
    role: 'standard',
    hp: 6,
    maxHp: 6,
    status: 'active',
    ...overrides,
  });

  it('returns base damage with no modifiers', () => {
    expect(computeEnemyDamage(makeTestEnemy(), 2, 'might')).toBe(2);
  });

  it('returns base damage when stat is none', () => {
    expect(computeEnemyDamage(makeTestEnemy(), 3, 'none')).toBe(3);
  });

  it('adds +1 bonus for revealed non-broken weakness with matching stat', () => {
    const enemy = makeTestEnemy({
      weaknesses: [{ id: 'w1', label: 'brute force', stat: 'might', revealed: true }],
    });
    expect(computeEnemyDamage(enemy, 2, 'might')).toBe(3);
  });

  it('uses damageMultiplier and bonusDamage when set on weakness', () => {
    const enemy = makeTestEnemy({
      weaknesses: [{ id: 'w1', label: 'magic core', stat: 'magic', revealed: true, damageMultiplier: 2, bonusDamage: 0 }],
    });
    expect(computeEnemyDamage(enemy, 3, 'magic')).toBe(6);
  });

  it('does not apply weakness when not revealed', () => {
    const enemy = makeTestEnemy({
      weaknesses: [{ id: 'w1', label: 'brute force', stat: 'might', revealed: false }],
    });
    expect(computeEnemyDamage(enemy, 2, 'might')).toBe(2);
  });

  it('does not apply weakness when broken', () => {
    const enemy = makeTestEnemy({
      weaknesses: [{ id: 'w1', label: 'brute force', stat: 'might', revealed: true, broken: true }],
    });
    expect(computeEnemyDamage(enemy, 2, 'might')).toBe(2);
  });

  it('applies resistance multiplier when stat matches', () => {
    const enemy = makeTestEnemy({
      resistances: [{ id: 'r1', label: 'thick hide', stat: 'might', damageMultiplier: 0.5 }],
    });
    expect(computeEnemyDamage(enemy, 4, 'might')).toBe(2);
  });

  it('weakness takes priority over resistance for the same stat', () => {
    const enemy = makeTestEnemy({
      weaknesses: [{ id: 'w1', label: 'exposed flank', stat: 'might', revealed: true }],
      resistances: [{ id: 'r1', label: 'thick hide', stat: 'might', damageMultiplier: 0.5 }],
    });
    expect(computeEnemyDamage(enemy, 2, 'might')).toBe(3);
  });

  it('clamps resistance result to at least 1', () => {
    const enemy = makeTestEnemy({
      resistances: [{ id: 'r1', label: 'near immunity', stat: 'mischief', damageMultiplier: 0.1 }],
    });
    expect(computeEnemyDamage(enemy, 2, 'mischief')).toBe(1);
  });
});
