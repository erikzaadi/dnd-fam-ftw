import { beforeEach, describe, expect, it } from 'vitest';
import type { Choice } from '../types.js';
import { clearActionPreviewsForTests, storeActionPreview, type StoredActionPreview } from './actionPreviewStore.js';
import { isRejection, normalizeTurnAction } from './turnActionInput.js';

const session = { id: 's1', revision: 4, activeCharacterId: 'pip' };

const storePreview = (overrides: Partial<Omit<StoredActionPreview, 'id' | 'createdAt'>> = {}): string => storeActionPreview({
  sessionId: 's1',
  revision: 4,
  actingCharacterId: 'pip',
  kind: 'free_text',
  originalAction: 'Juggle',
  interpretedAction: 'Pip juggles three apples',
  stat: 'mischief',
  difficulty: 'hard',
  difficultyValue: 15,
  ...overrides,
});

beforeEach(() => {
  clearActionPreviewsForTests();
});
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

  it('treats text that equals a suggestion label as free text: only an explicit id selects a choice', () => {
    expect(normalizeTurnAction({ action: 'Kick the door', statUsed: 'magic' }, session, choices))
      .toMatchObject({ kind: 'free_text', text: 'Kick the door', statUsed: 'magic' });
  });

  it('treats unpreviewed text as a free action with the submitted mechanics', () => {
    expect(normalizeTurnAction({ action: 'Juggle', statUsed: 'mischief', difficulty: 'easy', difficultyValue: 7 }, session, choices))
      .toMatchObject({ kind: 'free_text', text: 'Juggle', statUsed: 'mischief', difficulty: 'easy', difficultyValue: 7 });
  });

  it('takes a confirmed preview\'s mechanics over client echoes', () => {
    const previewId = storePreview();
    expect(normalizeTurnAction({ action: 'Pip juggles three apples', statUsed: 'might', difficulty: 'easy', difficultyValue: 5, previewId }, session, choices))
      .toMatchObject({ kind: 'free_text', text: 'Pip juggles three apples', actorId: 'pip', statUsed: 'mischief', difficulty: 'hard', difficultyValue: 15 });
  });

  it('keeps a previewed action free text when a suggestion with the same label arrived after the preview', () => {
    const previewId = storePreview({ originalAction: 'Kick the door', interpretedAction: 'Kick the door' });
    expect(normalizeTurnAction({ action: 'Kick the door', statUsed: 'mischief', previewId }, session, choices))
      .toMatchObject({ kind: 'free_text', statUsed: 'mischief', difficulty: 'hard' });
  });

  it('accepts either the original or the interpreted text of a preview', () => {
    const previewId = storePreview();
    expect(normalizeTurnAction({ action: 'Juggle', statUsed: 'mischief', previewId }, session, choices)).toMatchObject({ kind: 'free_text', text: 'Juggle' });
  });

  it('takes intent and target from the preview', () => {
    const previewId = storePreview({ actionIntent: 'aid_character', targetCharacterId: 'zara' });
    expect(normalizeTurnAction({ action: 'Juggle', statUsed: 'mischief', previewId }, session, choices))
      .toMatchObject({ kind: 'free_text', actionIntent: 'aid_character', targetCharacterId: 'zara' });
  });

  it('rejects confirmations that conflict with their preview', () => {
    const previewId = storePreview({ actionIntent: 'aid_character', targetCharacterId: 'zara' });
    const conflicting = [
      { action: 'Throw the apples', statUsed: 'mischief', previewId },
      { action: 'Juggle', statUsed: 'mischief', previewId, choiceId: 11 },
      { action: 'Juggle', statUsed: 'mischief', previewId, characterId: 'zara' },
      { action: 'Juggle', statUsed: 'mischief', previewId, targetCharacterId: 'pip' },
      { action: 'Juggle', statUsed: 'mischief', previewId, actionIntent: 'bless_character' },
      { action: 'Juggle', statUsed: 'none', previewId, actionType: 'use_item' as const, itemId: 'apple' },
    ];
    for (const request of conflicting) {
      expect(normalizeTurnAction(request, session, choices)).toMatchObject({ status: 409, body: { error: 'preview_mismatch' } });
    }
  });

  it('rejects unknown, stale and foreign previews', () => {
    expect(normalizeTurnAction({ action: 'Juggle', statUsed: 'mischief', previewId: 'missing' }, session, choices))
      .toMatchObject({ status: 409, body: { error: 'stale_preview' } });
    const previewId = storePreview();
    expect(normalizeTurnAction({ action: 'Juggle', statUsed: 'mischief', previewId }, { ...session, revision: 5 }, choices))
      .toMatchObject({ status: 409, body: { error: 'stale_preview' } });
    expect(normalizeTurnAction({ action: 'Juggle', statUsed: 'mischief', previewId }, { ...session, id: 's2' }, choices))
      .toMatchObject({ status: 409, body: { error: 'stale_preview' } });
  });

  it('builds item actions from an item preview, with the owner as actor', () => {
    const previewId = storePreview({ kind: 'item_give', originalAction: 'Give rope', interpretedAction: 'Zara gives Pip the rope', itemId: 'rope', itemOwnerCharacterId: 'zara', targetCharacterId: 'pip' });
    expect(normalizeTurnAction({ action: 'Zara gives Pip the rope', statUsed: 'none', previewId }, session, choices))
      .toMatchObject({ kind: 'item_give', itemId: 'rope', actorId: 'zara', targetCharacterId: 'pip' });
    expect(normalizeTurnAction({ action: 'Zara gives Pip the rope', statUsed: 'none', previewId, actionType: 'give_item', itemId: 'rope', ownerCharId: 'zara', targetCharId: 'pip' }, session, choices))
      .toMatchObject({ kind: 'item_give', itemId: 'rope' });
    expect(normalizeTurnAction({ action: 'Zara gives Pip the rope', statUsed: 'none', previewId, itemId: 'sword' }, session, choices))
      .toMatchObject({ status: 409, body: { error: 'preview_mismatch' } });
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
