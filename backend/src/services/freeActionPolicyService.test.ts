import { describe, expect, it } from 'vitest';
import type { ActionAttempt, Character, SessionState, TurnResult } from '../types.js';
import {
  buildFreeActionWarnings,
  ensureSuccessfulEnchantmentSuggestion,
  ensureSuccessfulHealingSuggestion,
  getFreeActionDifficulty,
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

  it('adds fallback healing when a successful healing action omitted suggestedHeal', () => {
    const turnResult = ensureSuccessfulHealingSuggestion(
      makeSession({ party: [makeChar({ name: 'Barnaby', hp: 5, max_hp: 10 })] }),
      makeAttempt(),
      makeTurnResult(),
    );

    expect(turnResult.suggestedHeal).toEqual([{ characterName: 'Barnaby', hp: 2 }]);
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
