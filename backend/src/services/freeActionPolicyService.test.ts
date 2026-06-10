import { describe, expect, it } from 'vitest';
import type { ActionAttempt, Character, SessionState, TurnResult } from '../types.js';
import {
  buildFreeActionWarnings,
  dropRedundantBuffAdds,
  ensureSuccessfulEnchantmentSuggestion,
  ensureSuccessfulHealingSuggestion,
  getFreeActionDifficulty,
  inferActionIntent,
  suppressFailedSupportDamage,
} from './freeActionPolicyService.js';

const makeChar = (overrides: Partial<Character> = {}): Character => ({
  id: 'hero-1',
  name: 'Barnaby',
  class: 'Mage',
  species: 'Human',
  quirk: 'Afraid of butterflies',
  hp: 10,
  max_hp: 10,
  status: 'active',
  stats: { might: 1, magic: 2, mischief: 3 },
  inventory: [],
  ...overrides,
});

const makeSession = (overrides: Partial<SessionState> = {}): SessionState => ({
  id: 'session-1',
  scene: 'A forked forest path',
  sceneId: 'scene-1',
  turn: 1,
  party: [makeChar()],
  activeCharacterId: 'hero-1',
  npcs: [],
  quests: [],
  lastChoices: [],
  tone: 'thrilling',
  recentHistory: [],
  displayName: 'Test World',
  difficulty: 'normal',
  savingsMode: false,
  interventionState: { rescuesUsed: 0 },
  storySummary: '',
  ...overrides,
});

const makeAttempt = (overrides: Partial<ActionAttempt> = {}): ActionAttempt => ({
  actionAttempt: 'Heal the whole party',
  actionResult: {
    success: true,
    roll: 14,
    statUsed: 'magic',
    impact: 'normal',
  },
  ...overrides,
});

const makeTurnResult = (overrides: Partial<TurnResult> = {}): TurnResult => ({
  narration: 'Warm light closes the worst wounds.',
  choices: [],
  imagePrompt: null,
  imageSuggested: false,
  suggestedHeal: null,
  suggestedRevive: null,
  suggestedBuffAdd: null,
  suggestedBuffRemove: null,
  ...overrides,
});

describe('freeActionPolicyService', () => {
  it('previews simple path actions as easy', () => {
    expect(getFreeActionDifficulty('Follow the hidden path')).toEqual({
      difficulty: 'easy',
      difficultyValue: 7,
    });
  });

  it('warns when healing can affect an injured party member', () => {
    const warnings = buildFreeActionWarnings('heal the party', makeSession({
      party: [makeChar({ hp: 4, max_hp: 10 })],
    }));

    expect(warnings[0]).toContain('Healing intent detected');
  });

  it('does not treat hyphenated enemy names like sleep-stealing as healing intent', () => {
    const action = 'Conjure an illusion to frighten the sleep-stealing tinker with authority';
    const warnings = buildFreeActionWarnings(action, makeSession({
      party: [makeChar({ hp: 4, max_hp: 10 })],
    }));

    expect(warnings).toHaveLength(0);
    expect(getFreeActionDifficulty(action)).toEqual({ difficulty: 'normal' });
  });

  it('still detects healing words at hyphen-free boundaries', () => {
    expect(getFreeActionDifficulty('Rest by the fire to recover')).toEqual({
      difficulty: 'easy',
      difficultyValue: 8,
    });
  });

  it('adds fallback healing when a successful healing action omitted suggestedHeal', () => {
    const turnResult = ensureSuccessfulHealingSuggestion(
      makeSession({ party: [makeChar({ name: 'Barnaby', hp: 5, max_hp: 10 })] }),
      makeAttempt(),
      makeTurnResult(),
    );

    expect(turnResult.suggestedHeal).toEqual([{ characterName: 'Barnaby', hp: 2 }]);
  });

  it('treats a shared victory feast as party-wide recovery', () => {
    const turnResult = ensureSuccessfulHealingSuggestion(
      makeSession({
        party: [
          makeChar({ id: 'hero-1', name: 'Barnaby', hp: 5, max_hp: 10 }),
          makeChar({ id: 'hero-2', name: 'Zara', hp: 7, max_hp: 10 }),
        ],
      }),
      makeAttempt({
        actionAttempt: 'Rest and share a "victory feast" to regain strength',
        actionResult: {
          success: true,
          roll: 18,
          statUsed: 'might',
          impact: 'strong',
        },
      }),
      makeTurnResult(),
    );

    expect(turnResult.suggestedHeal).toEqual([
      { characterName: 'Barnaby', hp: 4 },
      { characterName: 'Zara', hp: 4 },
    ]);
  });

  it('adds fallback revive for a downed party member', () => {
    const turnResult = ensureSuccessfulHealingSuggestion(
      makeSession({ party: [makeChar({ name: 'Zara', hp: 0, status: 'downed' })] }),
      makeAttempt({ actionAttempt: 'revive Zara' }),
      makeTurnResult(),
    );

    expect(turnResult.suggestedRevive).toEqual({ characterName: 'Zara', hp: 3 });
  });

  it('adds fallback item update when a successful enchantment names another hero item', () => {
    const swordOwner = makeChar({
      id: 'hero-2',
      name: 'Zara',
      inventory: [{
        id: 'sword-1',
        name: 'Moon Sword',
        description: 'A silver blade.',
        statBonuses: { might: 1 },
      }],
    });
    const turnResult = ensureSuccessfulEnchantmentSuggestion(
      makeSession({
        party: [makeChar({ id: 'hero-1', name: 'Barnaby' }), swordOwner],
        activeCharacterId: 'hero-1',
      }),
      makeAttempt({
        actionAttempt: 'Enchant Zara Moon Sword with bright magic',
        actionResult: {
          success: true,
          roll: 16,
          statUsed: 'magic',
          impact: 'normal',
        },
      }),
      makeTurnResult(),
    );

    expect(turnResult.suggestedInventoryUpdate).toMatchObject({
      characterName: 'Zara',
      itemName: 'Moon Sword',
      statBonuses: { might: 1, magic: 1 },
      condition: 'Enchanted',
    });
  });
});

describe('dropRedundantBuffAdds', () => {
  const inspiredChar = () => makeChar({
    name: 'Barnaby',
    buffs: [{ id: 'buff-1', name: 'Inspired', kind: 'buff', description: 'Fired up.', statBonuses: { might: 1 }, remainingTurns: 2 }],
  });

  const inspiredAdd = (characterName: string) => ({
    characterName,
    name: 'Inspired',
    kind: 'buff' as const,
    description: 'Fired up.',
    statBonuses: { might: 1 },
    remainingTurns: 2,
  });

  it('drops a buff the target already carries on a non-support action', () => {
    const turnResult = dropRedundantBuffAdds(
      makeSession({ party: [inspiredChar()] }),
      makeTurnResult({ suggestedBuffAdd: [inspiredAdd('Barnaby')] }),
    );

    expect(turnResult.suggestedBuffAdd).toBeNull();
  });

  it('keeps buffs for targets that do not have them', () => {
    const turnResult = dropRedundantBuffAdds(
      makeSession({ party: [inspiredChar(), makeChar({ id: 'hero-2', name: 'Zara' })] }),
      makeTurnResult({ suggestedBuffAdd: [inspiredAdd('Barnaby'), inspiredAdd('Zara')] }),
    );

    expect(turnResult.suggestedBuffAdd).toEqual([inspiredAdd('Zara')]);
  });

  it('allows deliberate support actions to refresh an existing buff', () => {
    const turnResult = dropRedundantBuffAdds(
      makeSession({ party: [inspiredChar()] }),
      makeTurnResult({ suggestedBuffAdd: [inspiredAdd('Barnaby')] }),
      'party_boost',
    );

    expect(turnResult.suggestedBuffAdd).toEqual([inspiredAdd('Barnaby')]);
  });

  it('matches buff names case-insensitively', () => {
    const turnResult = dropRedundantBuffAdds(
      makeSession({ party: [inspiredChar()] }),
      makeTurnResult({ suggestedBuffAdd: [{ ...inspiredAdd('Barnaby'), name: 'inspired' }] }),
    );

    expect(turnResult.suggestedBuffAdd).toBeNull();
  });
});

describe('suppressFailedSupportDamage', () => {
  const failedAttempt = (action: string) => makeAttempt({
    actionAttempt: action,
    actionResult: { success: false, roll: 1, statUsed: 'might', impact: 'extreme', difficultyTarget: 8 },
  });

  it('zeroes damage for a failed party boost', () => {
    const turnResult = suppressFailedSupportDamage(
      failedAttempt('Eytrig raises his shield, bracing the party for the peril ahead.'),
      makeTurnResult({ suggestedDamage: null }),
      'party_boost',
    );

    expect(turnResult.suggestedDamage).toBe(0);
  });

  it('zeroes damage for a failed healing action without an intent', () => {
    const turnResult = suppressFailedSupportDamage(
      failedAttempt('Heal the wounded warrior'),
      makeTurnResult({ suggestedDamage: 2 }),
    );

    expect(turnResult.suggestedDamage).toBe(0);
  });

  it('leaves combat failures untouched', () => {
    const turnResult = suppressFailedSupportDamage(
      failedAttempt('Strike the goblin with my axe'),
      makeTurnResult({ suggestedDamage: null }),
    );

    expect(turnResult.suggestedDamage).toBeNull();
  });

  it('does nothing on success', () => {
    const turnResult = suppressFailedSupportDamage(
      makeAttempt(),
      makeTurnResult({ suggestedDamage: null }),
      'party_boost',
    );

    expect(turnResult.suggestedDamage).toBeNull();
  });
});

describe('inferActionIntent', () => {
  const twoCharSession = () => makeSession({
    party: [
      makeChar({ id: 'hero-1', name: 'Barnaby' }),
      makeChar({ id: 'hero-2', name: 'Zara', status: 'active' }),
    ],
    activeCharacterId: 'hero-1',
  });

  it('returns undefined for a plain combat action', () => {
    expect(inferActionIntent('Strike the goblin with my sword', makeSession())).toBeUndefined();
  });

  it('returns undefined for a movement action', () => {
    expect(inferActionIntent('Sneak past the guard', makeSession())).toBeUndefined();
  });

  it('returns party_boost for a prayer targeting the whole party', () => {
    expect(inferActionIntent('Invoke a prayer to steady the party\'s resolve', makeSession())).toBe('party_boost');
  });

  it('returns party_boost for a rally action', () => {
    expect(inferActionIntent('Rally everyone with a battle cry', makeSession())).toBe('party_boost');
  });

  it('returns party_boost for inspire when no named target', () => {
    expect(inferActionIntent('Inspire the allies with a song', makeSession())).toBe('party_boost');
  });

  it('returns bless_character when a named party member is mentioned', () => {
    const session = twoCharSession();
    expect(inferActionIntent('Bless Zara before she strikes', session)).toBe('bless_character');
  });

  it('returns aid_character when aid verb and named target', () => {
    const session = twoCharSession();
    expect(inferActionIntent('Aid Zara with a distraction', session)).toBe('aid_character');
  });

  it('returns party_boost for chant targeting the whole group', () => {
    expect(inferActionIntent('Chant a war song for everyone', makeSession())).toBe('party_boost');
  });

  it('returns party_boost for devotion with no named target', () => {
    expect(inferActionIntent('Dedicate this victory to the gods', makeSession())).toBe('party_boost');
  });

  it('returns improve_item when enchanting a carried item', () => {
    const sessionWithItem = makeSession({
      party: [makeChar({ inventory: [{ id: 'i1', name: 'Iron Shield', description: 'A sturdy shield.', consumable: false, transferable: true }] })],
    });
    expect(inferActionIntent('Enchant the Iron Shield with protective runes', sessionWithItem)).toBe('improve_item');
  });

  it('returns undefined for healing actions (handled separately)', () => {
    expect(inferActionIntent('Heal the wounded warrior', makeSession())).toBeUndefined();
  });
});
