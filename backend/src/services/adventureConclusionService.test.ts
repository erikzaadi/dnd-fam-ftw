import { describe, expect, it } from 'vitest';
import type { SessionState, TurnResult } from '../types.js';
import { buildDeterministicEpilogue } from './adventureConclusionService.js';

describe('buildDeterministicEpilogue', () => {
  it('keeps hero and place names capitalized', () => {
    const session = {
      displayName: 'The Lost Crown',
      party: [{ id: 'z', name: 'Zara' }],
      adventure: { objective: 'Find the crown of Eldoria.', participatingHeroIds: ['z'] },
    } as unknown as SessionState;
    const history = [{ characterId: 'z', lastAction: { actionAttempt: 'Zara casts a fireball at the Shadow of Eldoria', actionResult: { success: true, roll: 15, statUsed: 'magic' } } }] as unknown as TurnResult[];
    const text = buildDeterministicEpilogue(session, history, 'success');
    expect(text).toContain('"Find the crown of Eldoria", done');
    expect(text).toContain('Zara will be remembered for this: "Zara casts a fireball at the Shadow of Eldoria".');
  });
});
