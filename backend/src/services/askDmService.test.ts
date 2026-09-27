import { describe, expect, it } from 'vitest';
import type { SessionState } from '../types.js';
import { buildAskContext } from './askDmService.js';

const session = {
  scene: 'The moonstone hall',
  activeCharacterId: null,
  party: [],
  encounterState: {
    id: 'enc-1',
    name: 'The Moonstone Guardian',
    status: 'active',
    round: 1,
    areas: [],
    enemies: [{
      id: 'guardian',
      name: 'Guardian',
      role: 'boss',
      hp: 20,
      maxHp: 33,
      status: 'active',
      weaknesses: [
        { id: 'w1', label: 'cracked moonstone', revealed: true },
        { id: 'w2', label: 'secret rune', revealed: false },
        { id: 'w3', label: 'shattered eye', revealed: true, broken: true },
      ],
    }],
  },
} as unknown as SessionState;

describe('buildAskContext', () => {
  it('mentions only discovered, unbroken weaknesses, like the encounter panel', () => {
    const context = buildAskContext(session, null, null);
    expect(context).toContain('weak point: cracked moonstone');
    expect(context).not.toContain('secret rune');
    expect(context).not.toContain('shattered eye');
  });
});
