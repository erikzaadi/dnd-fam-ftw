import { describe, expect, it } from 'vitest';
import type { EncounterState } from '../types.js';
import { toCombatView } from './projection.js';

const encounter = (overrides: Partial<EncounterState> = {}): EncounterState => ({
  id: 'enc-1',
  name: 'The Moonstone Guardian',
  status: 'active',
  round: 2,
  objective: 'Break the cracked moonstone',
  areas: [],
  enemies: [{
    id: 'guardian',
    name: 'Guardian',
    role: 'boss',
    hp: 1,
    maxHp: 33,
    status: 'active',
    traits: ['stone skin'],
    weaknesses: [
      { id: 'w1', label: 'cracked moonstone', revealed: true },
      { id: 'w2', label: 'secret rune', revealed: false },
    ],
  }],
  ...overrides,
});

describe('toCombatView', () => {
  it('describes the foes when a fight starts, without hidden weaknesses', () => {
    const view = toCombatView(encounter({ round: 1 }), true);
    expect(view).toMatchObject({ started: true, ended: false, outcome: 'active' });
    const text = view.summary.join('\n');
    expect(text).toContain('A fight begins: The Moonstone Guardian.');
    expect(text).toContain('Goal: Break the cracked moonstone');
    expect(text).toContain('Guardian, a boss with 1/33 HP: stone skin; weak to cracked moonstone.');
    expect(text).not.toContain('secret rune');
  });

  it('reports remaining health while a fight goes on', () => {
    const view = toCombatView(encounter(), false);
    expect(view.summary).toEqual(['The Moonstone Guardian, round 2: Guardian has 1/33 HP left.']);
  });

  it('reports the outcome when a fight ends', () => {
    const ended = encounter({ status: 'defeated' });
    ended.enemies[0] = { ...ended.enemies[0], hp: 0, status: 'defeated' };
    const view = toCombatView(ended, false);
    expect(view).toMatchObject({ ended: true, outcome: 'defeated' });
    expect(view.summary).toEqual(['The fight is over (The Moonstone Guardian): Guardian is defeated.']);
  });
});
