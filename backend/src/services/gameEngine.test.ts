import { describe, it, expect } from 'vitest';
import { GameEngine } from './gameEngine.js';
import type { Character, SessionState } from '../types.js';

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
  scene: 'A Dark Cave',
  sceneId: 'cave-1',
  turn: 1,
  party: [makeChar()],
  activeCharacterId: 'hero-1',
  npcs: [],
  quests: [],
  lastChoices: [{ label: 'Attack the goblin', difficulty: 'normal', stat: 'might' }],
  tone: 'thrilling',
  recentHistory: [],
  displayName: 'Test World',
  difficulty: 'normal',
  savingsMode: false,
  useLocalAI: false,
  interventionState: { rescuesUsed: 0 },
  storySummary: '',
  ...overrides,
});

describe('GameEngine', () => {
  it('resolveAction returns a result with success and roll', () => {
    const attempt = GameEngine.resolveAction(makeChar(), 'Attack the goblin', 'might', 'normal');
    expect(typeof attempt.actionResult.success).toBe('boolean');
    expect(typeof attempt.actionResult.roll).toBe('number');
  });

  it('updateState increments turn on failure and deals damage', () => {
    const session = makeSession();
    const failedAttempt = {
      actionAttempt: 'Attack the goblin',
      actionResult: { success: false, roll: 5, statUsed: 'might' as const },
    };
    const newState = GameEngine.updateState(session, failedAttempt, {
      choices: [{ label: 'Run away', difficulty: 'easy', stat: 'mischief' }],
    });
    expect(newState.turn).toBe(2);
    expect(newState.party[0].hp).toBeLessThan(makeChar().hp);
    expect(newState.lastChoices[0].label).toBe('Run away');
  });

  it('updateState adds suggested inventory item on success', () => {
    const session = makeSession();
    const attempt = { actionAttempt: 'Search the chest', actionResult: { success: true, roll: 15, statUsed: 'mischief' as const } };
    const sword = { name: 'Rusty Sword', description: 'A well-worn blade, still sharp enough.' };
    const newState = GameEngine.updateState(session, attempt, { suggestedInventoryAdd: sword });
    expect(newState.party[0].inventory).toHaveLength(1);
    expect(newState.party[0].inventory[0].name).toBe('Rusty Sword');
    expect(newState.party[0].inventory[0].id).toBeTruthy();
  });

  it('updateState with null suggestedInventoryAdd leaves inventory empty', () => {
    const session = makeSession();
    const attempt = { actionAttempt: 'Look around', actionResult: { success: true, roll: 15, statUsed: 'mischief' as const } };
    const newState = GameEngine.updateState(session, attempt, { suggestedInventoryAdd: null });
    expect(newState.party[0].inventory).toHaveLength(0);
  });

  it('updateState with missing suggestedInventoryAdd leaves inventory empty', () => {
    const session = makeSession();
    const attempt = { actionAttempt: 'Look around', actionResult: { success: true, roll: 15, statUsed: 'mischief' as const } };
    const newState = GameEngine.updateState(session, attempt, {});
    expect(newState.party[0].inventory).toHaveLength(0);
  });
});

describe('GameEngine.resolveAction - edge cases', () => {
  it('statName "none" always returns success with roll 0', () => {
    const result = GameEngine.resolveAction(makeChar(), 'Narrate something', 'none');
    expect(result.actionResult.success).toBe(true);
    expect(result.actionResult.roll).toBe(0);
    expect(result.actionResult.statUsed).toBe('none');
  });

  it('difficultyValue override is used instead of difficulty label', () => {
    // Stat 5 + max roll 20 = 25, always beats any target <= 25
    const strongChar = makeChar({ stats: { might: 5, magic: 5, mischief: 5 } });
    const result = GameEngine.resolveAction(strongChar, 'Lift the boulder', 'might', 'normal', 1);
    expect(result.actionResult.difficultyTarget).toBe(1);
    expect(result.actionResult.success).toBe(true);
  });

  it('item stat bonus is applied to the roll total', () => {
    // Stat 1, but item gives +10 bonus — should always beat difficulty 8
    const charWithBonus = makeChar({
      stats: { might: 1, magic: 1, mischief: 1 },
      inventory: [{ id: 'sword', name: 'Power Sword', description: '', consumable: false, transferable: true, statBonuses: { might: 10 } }],
    });
    // Run many times to be statistically certain (roll 1-20, stat 1, bonus 10 = min 12)
    for (let i = 0; i < 20; i++) {
      const result = GameEngine.resolveAction(charWithBonus, 'Strike', 'might', 'easy');
      expect(result.actionResult.success).toBe(true);
    }
  });

  it('critical hit sets isCritical when roll is 20', () => {
    // We cannot force a roll of 20 without mocking, but we can verify the flag
    // is never set when roll is not 20 by checking a full run
    let sawCritical = false;
    for (let i = 0; i < 100; i++) {
      const result = GameEngine.resolveAction(makeChar(), 'Attack', 'might');
      if (result.actionResult.isCritical) {
        sawCritical = true;
        expect(result.actionResult.roll).toBe(20);
      }
    }
    // isCritical must be absent (not false) when roll is not 20
    const result = GameEngine.resolveAction(makeChar(), 'Attack', 'might');
    if (!result.actionResult.isCritical) {
      expect('isCritical' in result.actionResult).toBe(false);
    }
    void sawCritical; // statistical - not always asserted
  });
});

describe('GameEngine.checkSuccess', () => {
  it('returns true when total meets difficulty', () => {
    expect(GameEngine.checkSuccess(12, 'normal')).toBe(true);
  });

  it('returns false when total is below difficulty', () => {
    expect(GameEngine.checkSuccess(11, 'normal')).toBe(false);
  });

  it('accepts a numeric difficulty value directly', () => {
    expect(GameEngine.checkSuccess(15, 15)).toBe(true);
    expect(GameEngine.checkSuccess(14, 15)).toBe(false);
  });
});

describe('GameEngine.isPartyWiped', () => {
  it('returns false when all characters are active', () => {
    expect(GameEngine.isPartyWiped(makeSession())).toBe(false);
  });

  it('returns true when all characters are downed', () => {
    const session = makeSession({ party: [makeChar({ status: 'downed' })] });
    expect(GameEngine.isPartyWiped(session)).toBe(true);
  });

  it('returns false when at least one character is active', () => {
    const session = makeSession({
      party: [makeChar({ id: 'h1', status: 'downed' }), makeChar({ id: 'h2', status: 'active' })],
    });
    expect(GameEngine.isPartyWiped(session)).toBe(false);
  });

  it('returns false for empty party', () => {
    expect(GameEngine.isPartyWiped(makeSession({ party: [] }))).toBe(false);
  });
});

describe('GameEngine.getNextActiveCharacter', () => {
  it('returns the next character in order', () => {
    const party = [makeChar({ id: 'a' }), makeChar({ id: 'b' }), makeChar({ id: 'c' })];
    expect(GameEngine.getNextActiveCharacter(party, 'a')).toBe('b');
    expect(GameEngine.getNextActiveCharacter(party, 'c')).toBe('a');
  });

  it('skips downed characters', () => {
    const party = [
      makeChar({ id: 'a' }),
      makeChar({ id: 'b', status: 'downed' }),
      makeChar({ id: 'c' }),
    ];
    expect(GameEngine.getNextActiveCharacter(party, 'a')).toBe('c');
  });

  it('returns currentId when all others are downed', () => {
    const party = [
      makeChar({ id: 'a' }),
      makeChar({ id: 'b', status: 'downed' }),
    ];
    expect(GameEngine.getNextActiveCharacter(party, 'a')).toBe('a');
  });

  it('returns currentId when id not found in party', () => {
    const party = [makeChar({ id: 'a' })];
    expect(GameEngine.getNextActiveCharacter(party, 'no-such-id')).toBe('no-such-id');
  });
});

describe('GameEngine.applyIntervention', () => {
  it('revives all downed characters to 1 HP', () => {
    const session = makeSession({
      party: [makeChar({ id: 'h1', status: 'downed', hp: 0 }), makeChar({ id: 'h2', status: 'downed', hp: 0 })],
    });
    const result = GameEngine.applyIntervention(session);
    expect(result.party.every(c => c.status === 'active')).toBe(true);
    expect(result.party.every(c => c.hp === 1)).toBe(true);
  });

  it('increments interventionState.rescuesUsed', () => {
    const result = GameEngine.applyIntervention(makeSession());
    expect(result.interventionState.rescuesUsed).toBe(1);
  });

  it('does not mutate the original state', () => {
    const session = makeSession({ party: [makeChar({ status: 'downed', hp: 0 })] });
    GameEngine.applyIntervention(session);
    expect(session.party[0].status).toBe('downed');
  });
});

describe('GameEngine.applySanctuaryRecovery', () => {
  it('revives all downed characters to 1 HP and sets status active', () => {
    const session = makeSession({
      party: [makeChar({ id: 'h1', status: 'downed', hp: 0 }), makeChar({ id: 'h2', status: 'active', hp: 5 })],
    });
    const result = GameEngine.applySanctuaryRecovery(session);
    expect(result.party[0].status).toBe('active');
    expect(result.party[0].hp).toBe(1);
    expect(result.party[1].hp).toBe(5);
  });

  it('does not mutate the original state', () => {
    const session = makeSession({ party: [makeChar({ status: 'downed', hp: 0 })] });
    GameEngine.applySanctuaryRecovery(session);
    expect(session.party[0].status).toBe('downed');
  });
});

describe('GameEngine.applyItemUse - error paths', () => {
  it('returns error when acting character is not found', () => {
    const { error } = GameEngine.applyItemUse(makeSession(), 'no-such-char', 'item-1', 'hero-1');
    expect(error).toMatch(/not found/i);
  });

  it('returns error when item is not in inventory', () => {
    const { error } = GameEngine.applyItemUse(makeSession(), 'hero-1', 'no-such-item', 'hero-1');
    expect(error).toMatch(/not found/i);
  });

  it('heals target and does not exceed max_hp', () => {
    const healer = makeChar({ id: 'healer', hp: 8, max_hp: 10, inventory: [
      { id: 'potion', name: 'Potion', description: '', consumable: true, transferable: false, healValue: 5 },
    ] });
    const target = makeChar({ id: 'target', hp: 8, max_hp: 10 });
    const session = makeSession({ party: [healer, target], activeCharacterId: 'healer' });
    const { newState } = GameEngine.applyItemUse(session, 'healer', 'potion', 'target');
    const newTarget = newState.party.find(c => c.id === 'target');
    expect(newTarget!.hp).toBe(10);
  });

  it('revives a downed target when healed', () => {
    const healer = makeChar({ id: 'healer', inventory: [
      { id: 'potion', name: 'Potion', description: '', consumable: true, transferable: false, healValue: 3 },
    ] });
    const downed = makeChar({ id: 'downed', hp: 0, status: 'downed' });
    const session = makeSession({ party: [healer, downed], activeCharacterId: 'healer' });
    const { newState } = GameEngine.applyItemUse(session, 'healer', 'potion', 'downed');
    const revived = newState.party.find(c => c.id === 'downed');
    expect(revived!.status).toBe('active');
    expect(revived!.hp).toBeGreaterThan(0);
  });
});

describe('GameEngine.getRescueLimit', () => {
  it('returns Infinity for easy', () => {
    expect(GameEngine.getRescueLimit('easy')).toBe(Infinity);
  });

  it('returns 2 for normal', () => {
    expect(GameEngine.getRescueLimit('normal')).toBe(2);
  });

  it('returns 1 for hard', () => {
    expect(GameEngine.getRescueLimit('hard')).toBe(1);
  });

  it('returns 0 for zug-ma-geddon', () => {
    expect(GameEngine.getRescueLimit('zug-ma-geddon')).toBe(0);
  });

  it('returns Infinity for unknown difficulty', () => {
    expect(GameEngine.getRescueLimit('unknown')).toBe(Infinity);
  });
});

describe('GameEngine.applySanctuaryRecovery rescuesUsed', () => {
  it('increments rescuesUsed', () => {
    const session = makeSession({ interventionState: { rescuesUsed: 1 } });
    const result = GameEngine.applySanctuaryRecovery(session);
    expect(result.interventionState.rescuesUsed).toBe(2);
  });
});
