import { describe, expect, it } from 'vitest';
import type { SessionState } from '../types.js';
import { buildResolvedTurnFacts } from './resolvedTurn.js';

const hero = (id: string, name: string, hp: number) => ({
  id, name, class: 'Rogue', species: 'Halfling', quirk: '', hp, max_hp: 10, status: 'active' as const,
  stats: { might: 1, magic: 1, mischief: 3 }, inventory: [] as SessionState['party'][number]['inventory'],
});

const base = (overrides: Partial<SessionState> = {}): SessionState => ({
  id: 's', scene: 'Kitchen', sceneId: 'k', turn: 3, revision: 7,
  party: [hero('a', 'Pip', 8), hero('b', 'Zara', 10)],
  activeCharacterId: 'a', npcs: [], quests: [], lastChoices: [], tone: '', recentHistory: [], displayName: 'Realm',
  difficulty: 'normal', savingsMode: true, interventionState: { rescuesUsed: 0 }, storySummary: '',
  ...overrides,
});

describe('buildResolvedTurnFacts', () => {
  it('lists every committed consequence and closes the door on invented ones', () => {
    const before = base({
      encounterState: { id: 'e', name: 'Pan Ambush', status: 'active', round: 1, areas: [], enemies: [{ id: 'p', name: 'Pan', role: 'minion', hp: 2, maxHp: 3, status: 'active' }] },
    });
    const after = base({
      party: [{ ...hero('a', 'Pip', 6), inventory: [{ id: 'i', name: 'Silver Ladle', description: '' }] }, hero('b', 'Zara', 10)],
      encounterState: { id: 'e', name: 'Pan Ambush', status: 'defeated', round: 2, areas: [], enemies: [{ id: 'p', name: 'Pan', role: 'minion', hp: 0, maxHp: 3, status: 'defeated' }] },
    });

    const facts = buildResolvedTurnFacts({
      previousSession: before,
      resolvedState: after,
      actionAttempt: { actionAttempt: 'Smash the pan', actionResult: { success: true, roll: 17, statUsed: 'might', difficultyTarget: 12, impact: 'strong' } },
      actingCharId: 'a',
    });

    expect(facts).toMatchObject({ baseRevision: 7, actorName: 'Pip', outcome: 'success', nextActorName: 'Zara' });
    expect(facts.encounter).toMatchObject({ name: 'Pan Ambush', resolved: true, started: false });
    const text = facts.facts.join('\n');
    expect(text).toContain('SUCCEEDED (rolled 17 vs 12, strong impact)');
    expect(text).toContain('Pip lost 2 HP (now 6/10)');
    expect(text).toContain('Pip gained the item "Silver Ladle"');
    expect(text).toContain('Pan is defeated');
    expect(text).toContain('The fight "Pan Ambush" is over (defeated)');
    expect(facts.facts[facts.facts.length - 1]).toContain('Nothing else changed mechanically');
  });

  it('describes a no-roll action without an outcome it did not have', () => {
    const facts = buildResolvedTurnFacts({
      previousSession: base(),
      resolvedState: base(),
      actionAttempt: { actionAttempt: 'Pip used Healing Potion', actionResult: { success: true, roll: 0, statUsed: 'none' } },
      actingCharId: 'a',
    });
    expect(facts.roll).toBeNull();
    expect(facts.outcome).toBe('no_roll');
    expect(facts.encounter).toBeNull();
  });
});
