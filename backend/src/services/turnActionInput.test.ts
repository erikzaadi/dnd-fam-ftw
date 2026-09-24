import { describe, expect, it } from 'vitest';
import type { Choice } from '../types.js';
import { isRejection, normalizeTurnAction } from './turnActionInput.js';

const session = { activeCharacterId: 'pip' };
const choices: Choice[] = [
  { id: 11, label: 'Kick the door', stat: 'might', difficulty: 'normal', difficultyValue: 12 },
  { id: 12, label: 'Charm the lock', stat: 'magic', difficulty: 'easy', difficultyValue: 8, flavor: 'spotlight' },
];

describe('normalizeTurnAction', () => {
  it('resolves a suggestion by stable id and takes its mechanics from the stored descriptor', () => {
    const action = normalizeTurnAction({ action: 'Charm the lock', statUsed: 'might', difficulty: 'hard', choiceId: 12 }, session, choices);
    expect(action).toMatchObject({ kind: 'choice', text: 'Charm the lock', actorId: 'pip', choice: { id: 12, stat: 'magic', difficulty: 'easy' } });
  });

  it('rejects an id from an earlier turn as stale instead of guessing', () => {
    const action = normalizeTurnAction({ action: 'Old option', statUsed: 'might', choiceId: 3 }, session, choices);
    expect(isRejection(action)).toBe(true);
    expect(action).toMatchObject({ status: 409, body: { error: 'stale_choice' } });
  });

  it('keeps legacy label matching for clients that send no id', () => {
    expect(normalizeTurnAction({ action: 'Kick the door', statUsed: 'magic' }, session, choices)).toMatchObject({ kind: 'choice', choice: { id: 11 } });
  });

  it('treats unmatched text as a free action with the submitted mechanics', () => {
    expect(normalizeTurnAction({ action: 'Juggle', statUsed: 'mischief', difficulty: 'easy', difficultyValue: 7, previewId: 'p1' }, session, choices))
      .toMatchObject({ kind: 'free_text', text: 'Juggle', statUsed: 'mischief', difficulty: 'easy', difficultyValue: 7, previewId: 'p1' });
  });

  it('maps legacy item aliases to item actions', () => {
    expect(normalizeTurnAction({ action: 'use item', statUsed: 'none', itemId: 'potion', ownerCharId: 'zara', targetCharId: 'pip' }, session, choices))
      .toMatchObject({ kind: 'item_use', itemId: 'potion', actorId: 'zara', targetCharacterId: 'pip' });
    expect(normalizeTurnAction({ action: 'give item', statUsed: 'none', itemId: 'rope' }, session, choices))
      .toMatchObject({ kind: 'item_give', itemId: 'rope', actorId: 'pip' });
    expect(normalizeTurnAction({ action: 'anything', statUsed: 'none', actionType: 'use_item' }, session, choices))
      .toMatchObject({ status: 400, body: { error: 'missing_item' } });
  });
});
