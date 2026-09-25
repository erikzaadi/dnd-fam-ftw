import { describe, expect, it } from 'vitest';
import type { EncounterState, SessionState, TurnResult } from '../types.js';
import { alignTurnWithResolvedEncounter } from './turnRepairs.js';

const swarm = (status: 'active' | 'defeated') => ({
  id: 'e1',
  name: 'Whirling Contract Swarm',
  aliases: ['whirling', 'contract', 'swarm'],
  role: 'hazard' as const,
  hp: 0,
  maxHp: 0,
  status,
});

const encounter = (status: EncounterState['status'], enemyStatus: 'active' | 'defeated'): EncounterState => ({
  id: 'enc-1',
  name: 'Golden Rotunda Contract Whirl',
  status,
  enemies: [swarm(enemyStatus)],
  round: 3,
} as unknown as EncounterState);

const gothwyn = (inventory: { id: string; name: string }[]) => ({
  id: 'c3',
  name: 'Gothwyn',
  class: 'Wizard',
  species: 'Tauren',
  quirk: '',
  hp: 10,
  max_hp: 10,
  status: 'active' as const,
  stats: { might: 1, magic: 5, mischief: 1 },
  inventory: inventory.map(item => ({ ...item, description: '', transferable: true, consumable: false })),
});

const sessions = (loot: { id: string; name: string }[]) => {
  const before = { party: [gothwyn([])], encounterState: encounter('active', 'active'), storySummary: '' } as unknown as SessionState;
  const after = { party: [gothwyn(loot)], encounterState: encounter('defeated', 'defeated') } as unknown as SessionState;
  return { before, after };
};

const turn = (narration: string): TurnResult => ({ narration, choices: [], imagePrompt: null, imageSuggested: false });

describe('alignTurnWithResolvedEncounter', () => {
  it('keeps narration that already tells the defeat, adding only unmentioned loot', () => {
    const { before, after } = sessions([{ id: 'i1', name: '📎 Giant Arcane Paperclip' }]);
    const result = turn('Gothwyn conjures a colossal paperclip that snaps shut around the swarm. The contracts crumple and the swarm collapses into a pile of harmless paper.');

    alignTurnWithResolvedEncounter(before, after, result);

    expect(result.narration.startsWith('Gothwyn conjures a colossal paperclip')).toBe(true);
    expect(result.narration).toContain('Gothwyn claims 📎 Giant Arcane Paperclip');
    expect(result.narration).not.toContain('The immediate fight is over');
  });

  it('does not repeat loot the narration already names', () => {
    const { before, after } = sessions([{ id: 'i1', name: '📎 Giant Arcane Paperclip' }]);
    const result = turn('The swarm is defeated, and Gothwyn pockets the giant arcane paperclip.');

    alignTurnWithResolvedEncounter(before, after, result);

    expect(result.narration).toBe('The swarm is defeated, and Gothwyn pockets the giant arcane paperclip.');
  });

  it('replaces narration that missed the defeat', () => {
    const { before, after } = sessions([]);
    const result = turn('Gothwyn waves his hands while the swarm keeps swirling angrily.');

    alignTurnWithResolvedEncounter(before, after, result);

    expect(result.narration).toContain('Whirling Contract Swarm collapses, defeated.');
    expect(result.narration).toContain('The immediate fight is over.');
  });

  it('replaces narration that describes a defeat without naming the enemy', () => {
    const { before, after } = sessions([]);
    const result = turn('Something falls somewhere in the hall.');

    alignTurnWithResolvedEncounter(before, after, result);

    expect(result.narration).toContain('Whirling Contract Swarm collapses, defeated.');
  });
});
