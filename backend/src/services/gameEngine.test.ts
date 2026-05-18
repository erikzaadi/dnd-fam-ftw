import { describe, it, expect, vi } from 'vitest';
import { GameEngine } from './gameEngine.js';
import type { Character, EncounterSeed, EncounterState, SessionState } from '../types.js';

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

  it('updateState does not add a suggested inventory item already carried by another party member', () => {
    const session = makeSession({
      party: [
        makeChar({ id: 'hero-1', name: 'Barnaby', inventory: [] }),
        makeChar({ id: 'hero-2', name: 'Mira', inventory: [{ id: 'item-1', name: 'Ancient Map', description: 'Shows the route.' }] }),
      ],
    });
    const attempt = { actionAttempt: 'Search the chest', actionResult: { success: true, roll: 15, statUsed: 'mischief' as const } };

    const newState = GameEngine.updateState(session, attempt, {
      suggestedInventoryAdd: { name: '🗺️ Ancient Map', description: 'Shows the route.' },
    });

    expect(newState.party.flatMap(c => c.inventory.filter(i => i.name.includes('Ancient Map')))).toHaveLength(1);
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

  it('applyGiveItem moves the item and names the selected target in the action attempt', () => {
    const giver = makeChar({
      id: 'giver',
      name: 'Pip',
      inventory: [{ id: 'moon-key', name: 'Moon Key', description: 'Silver key', transferable: true, consumable: false }],
    });
    const nextInTurn = makeChar({ id: 'next', name: 'Barnaby' });
    const chosenTarget = makeChar({ id: 'target', name: 'Zara' });
    const session = makeSession({
      activeCharacterId: 'giver',
      party: [giver, nextInTurn, chosenTarget],
    });

    const result = GameEngine.applyGiveItem(session, 'giver', 'moon-key', 'target');

    expect(result.error).toBeUndefined();
    expect(result.actionAttempt.actionAttempt).toBe('Pip gave Moon Key to Zara');
    expect(result.newState.party.find(c => c.id === 'giver')!.inventory).toHaveLength(0);
    expect(result.newState.party.find(c => c.id === 'next')!.inventory).toHaveLength(0);
    expect(result.newState.party.find(c => c.id === 'target')!.inventory[0].name).toBe('Moon Key');
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
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const strongChar = makeChar({ stats: { might: 5, magic: 5, mischief: 5 } });
    const result = GameEngine.resolveAction(strongChar, 'Lift the boulder', 'might', 'normal', 1);
    vi.restoreAllMocks();
    expect(result.actionResult.difficultyTarget).toBe(1);
    expect(result.actionResult.success).toBe(true);
  });

  it('natural 1 fails even when stat and item bonuses meet the target', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const charWithBonus = makeChar({
      stats: { might: 5, magic: 5, mischief: 5 },
      inventory: [{ id: 'sword', name: 'Power Sword', description: '', consumable: false, transferable: true, statBonuses: { might: 10 } }],
    });

    const result = GameEngine.resolveAction(charWithBonus, 'Step through the portal', 'might', 'easy', 1);
    vi.restoreAllMocks();

    expect(result.actionResult.roll).toBe(1);
    expect(result.actionResult.difficultyTarget).toBe(1);
    expect(result.actionResult.success).toBe(false);
    expect(result.actionResult.impact).toBe('extreme');
  });

  it('item stat bonus is applied to the roll total', () => {
    // Stat 1, but item gives +10 bonus — should always beat difficulty 8
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const charWithBonus = makeChar({
      stats: { might: 1, magic: 1, mischief: 1 },
      inventory: [{ id: 'sword', name: 'Power Sword', description: '', consumable: false, transferable: true, statBonuses: { might: 10 } }],
    });
    // Run many times to be statistically certain (roll 1-20, stat 1, bonus 10 = min 12)
    for (let i = 0; i < 20; i++) {
      const result = GameEngine.resolveAction(charWithBonus, 'Strike', 'might', 'easy');
      expect(result.actionResult.success).toBe(true);
    }
    vi.restoreAllMocks();
  });

  it('helper bonus is applied to combo rolls', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const helperChar = makeChar({ stats: { might: 1, magic: 1, mischief: 1 } });

    const result = GameEngine.resolveAction(helperChar, 'Distract the guard together', 'mischief', 'normal', 14, { name: 'Zara', bonus: 2 });
    vi.restoreAllMocks();

    expect(result.actionResult.roll).toBe(11);
    expect(result.actionResult.success).toBe(true);
    expect(result.actionResult.helperBonus).toBe(2);
    expect(result.actionResult.helperCharacterName).toBe('Zara');
  });

  it('choice item bonus is applied to marked gear rolls', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const itemChar = makeChar({ stats: { might: 1, magic: 1, mischief: 1 } });

    const result = GameEngine.resolveAction(itemChar, 'Raise the moon key', 'magic', 'normal', 14, undefined, { name: 'Moon Key', ownerName: 'Pip', bonus: 2 });
    vi.restoreAllMocks();

    expect(result.actionResult.roll).toBe(11);
    expect(result.actionResult.success).toBe(true);
    expect(result.actionResult.choiceItemBonus).toBe(2);
    expect(result.actionResult.choiceItemName).toBe('Moon Key');
    expect(result.actionResult.choiceItemOwnerName).toBe('Pip');
  });

  it('character edge bonus is applied to social and spotlight rolls', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const socialChar = makeChar({ stats: { might: 1, magic: 1, mischief: 1 } });

    const result = GameEngine.resolveAction(socialChar, 'Charm the suspicious guard', 'mischief', 'normal', 14, undefined, undefined, { label: 'social edge', bonus: 2 });
    vi.restoreAllMocks();

    expect(result.actionResult.roll).toBe(11);
    expect(result.actionResult.success).toBe(true);
    expect(result.actionResult.characterBonus).toBe(2);
    expect(result.actionResult.characterBonusLabel).toBe('social edge');
  });

  it('buff bonus is applied to rolls and capped at three total', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const buffedChar = makeChar({
      stats: { might: 1, magic: 1, mischief: 1 },
      buffs: [
        { id: 'bless', name: 'Blessed', description: 'Light guides the strike.', statBonuses: { might: 2 }, remainingTurns: 2 },
        { id: 'courage', name: 'Courage', description: 'Fear falls away.', statBonuses: { might: 2 }, remainingTurns: 2 },
      ],
    });

    const result = GameEngine.resolveAction(buffedChar, 'Strike with blessed courage', 'might', 'normal', 15);
    vi.restoreAllMocks();

    expect(result.actionResult.roll).toBe(11);
    expect(result.actionResult.success).toBe(true);
    expect(result.actionResult.buffBonus).toBe(3);
    expect(result.actionResult.buffBonusLabel).toBe('buffs');
  });

  it('curse penalty is applied to rolls and capped at negative three total', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const cursedChar = makeChar({
      stats: { might: 1, magic: 1, mischief: 1 },
      buffs: [
        { id: 'jinx', name: 'Jinxed', kind: 'curse', description: 'Bad luck clings.', statBonuses: { mischief: -2 }, remainingTurns: 2 },
        { id: 'rattled', name: 'Rattled', kind: 'curse', description: 'Fear shakes focus.', statBonuses: { mischief: -2 }, remainingTurns: 2 },
      ],
    });

    const result = GameEngine.resolveAction(cursedChar, 'Slip past the guard', 'mischief', 'normal', 10);
    vi.restoreAllMocks();

    expect(result.actionResult.roll).toBe(11);
    expect(result.actionResult.success).toBe(false);
    expect(result.actionResult.buffBonus).toBe(-3);
    expect(result.actionResult.buffBonusLabel).toBe('curses');
  });

  it('strong impact is set when the result beats the target by a lot', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const strongChar = makeChar({ stats: { might: 8, magic: 1, mischief: 1 } });

    const result = GameEngine.resolveAction(strongChar, 'Smash the door', 'might', 'easy', 8);
    vi.restoreAllMocks();

    expect(result.actionResult.roll).toBe(11);
    expect(result.actionResult.success).toBe(true);
    expect(result.actionResult.impact).toBe('strong');
  });

  it('extreme impact is set when the result beats the target massively', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const strongChar = makeChar({
      stats: { might: 10, magic: 1, mischief: 1 },
      inventory: [{ id: 'hammer', name: 'Power Hammer', description: '', consumable: false, transferable: true, statBonuses: { might: 3 } }],
    });

    const result = GameEngine.resolveAction(strongChar, 'Smash the gate', 'might', 'easy', 8);
    vi.restoreAllMocks();

    expect(result.actionResult.roll).toBe(11);
    expect(result.actionResult.success).toBe(true);
    expect(result.actionResult.impact).toBe('extreme');
  });

  it('natural 20 succeeds even when total is below the target', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const weakChar = makeChar({ stats: { might: 1, magic: 1, mischief: 1 } });

    const result = GameEngine.resolveAction(weakChar, 'Leap the impossible chasm', 'might', 'hard', 30);
    vi.restoreAllMocks();

    expect(result.actionResult.roll).toBe(20);
    expect(result.actionResult.impact).toBe('extreme');
    expect('isCritical' in result.actionResult).toBe(false);
    expect(result.actionResult.difficultyTarget).toBe(30);
    expect(result.actionResult.success).toBe(true);
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

describe('GameEngine short-lived buffs and curses', () => {
  it('adds a clamped buff to the target character', () => {
    const session = makeSession({
      party: [makeChar({ id: 'caster', name: 'Mira' }), makeChar({ id: 'target', name: 'Brom' })],
      activeCharacterId: 'caster',
    });
    const attempt = { actionAttempt: 'Bless Brom', actionResult: { success: true, roll: 16, statUsed: 'magic' as const } };

    const result = GameEngine.updateState(session, attempt, {
      suggestedBuffAdd: [{
        characterName: 'Brom',
        name: 'Blessed',
        description: 'A quick blessing steadies his hands.',
        statBonuses: { might: 9 },
        remainingTurns: 99,
        sourceCharacterName: 'Mira',
      }],
    });

    const target = result.party.find(c => c.id === 'target')!;
    expect(target.buffs).toHaveLength(1);
    expect(target.buffs![0].id).toBeTruthy();
    expect(target.buffs![0].statBonuses?.might).toBe(2);
    expect(target.buffs![0].remainingTurns).toBe(3);
  });

  it('adds a clamped curse from an enemy source', () => {
    const session = makeSession({
      party: [makeChar({ id: 'target', name: 'Brom' })],
      activeCharacterId: 'target',
    });
    const attempt = { actionAttempt: 'Face the bog witch', actionResult: { success: false, roll: 5, statUsed: 'magic' as const } };

    const result = GameEngine.updateState(session, attempt, {
      suggestedDamage: 0,
      suggestedBuffAdd: [{
        characterName: 'Brom',
        name: 'Jinxed',
        kind: 'curse',
        description: 'The bog witch hooks bad luck onto him.',
        statBonuses: { mischief: -9 },
        remainingUses: 1,
        sourceCharacterName: 'Bog Witch',
      }],
    });

    expect(result.party[0].buffs).toHaveLength(1);
    expect(result.party[0].buffs![0].kind).toBe('curse');
    expect(result.party[0].buffs![0].statBonuses?.mischief).toBe(-2);
    expect(result.party[0].buffs![0].sourceCharacterName).toBe('Bog Witch');
  });

  it('refreshes an existing buff with the same name instead of stacking it', () => {
    const target = makeChar({
      id: 'target',
      name: 'Brom',
      buffs: [{ id: 'existing', name: 'Blessed', description: 'Old light.', statBonuses: { might: 1 }, remainingTurns: 1 }],
    });
    const session = makeSession({
      party: [makeChar({ id: 'caster', name: 'Mira' }), target],
      activeCharacterId: 'caster',
    });
    const attempt = { actionAttempt: 'Refresh Brom blessing', actionResult: { success: true, roll: 16, statUsed: 'magic' as const } };

    const result = GameEngine.updateState(session, attempt, {
      suggestedBuffAdd: [{
        characterName: 'Brom',
        name: 'Blessed',
        description: 'New light.',
        statBonuses: { might: 2 },
        remainingTurns: 2,
      }],
    });

    const refreshed = result.party.find(c => c.id === 'target')!.buffs!;
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0].id).toBe('existing');
    expect(refreshed[0].description).toBe('New light.');
    expect(refreshed[0].remainingTurns).toBe(2);
  });

  it('expires remainingUses after a buff helps a roll', () => {
    const acting = makeChar({
      id: 'hero-1',
      buffs: [{ id: 'haste', name: 'Hasted', description: 'Fast feet.', statBonuses: { mischief: 1 }, remainingUses: 1 }],
    });
    const session = makeSession({ party: [acting], activeCharacterId: 'hero-1' });
    const attempt = { actionAttempt: 'Dash through the trap', actionResult: { success: true, roll: 12, statUsed: 'mischief' as const, buffBonus: 1 } };

    const result = GameEngine.updateState(session, attempt, {});

    expect(result.party[0].buffs).toEqual([]);
  });

  it('expires remainingUses after a curse affects a roll', () => {
    const acting = makeChar({
      id: 'hero-1',
      buffs: [{ id: 'jinx', name: 'Jinxed', kind: 'curse', description: 'Bad luck clings.', statBonuses: { mischief: -1 }, remainingUses: 1 }],
    });
    const session = makeSession({ party: [acting], activeCharacterId: 'hero-1' });
    const attempt = { actionAttempt: 'Pick the lock', actionResult: { success: false, roll: 8, statUsed: 'mischief' as const, buffBonus: -1 } };

    const result = GameEngine.updateState(session, attempt, {});

    expect(result.party[0].buffs).toEqual([]);
  });

  it('expires remainingTurns after the buffed character acts', () => {
    const acting = makeChar({
      id: 'hero-1',
      buffs: [{ id: 'shield', name: 'Shielded', description: 'A fading ward.', statBonuses: { might: 1 }, remainingTurns: 1 }],
    });
    const session = makeSession({ party: [acting], activeCharacterId: 'hero-1' });
    const attempt = { actionAttempt: 'Hold the bridge', actionResult: { success: true, roll: 12, statUsed: 'might' as const } };

    const result = GameEngine.updateState(session, attempt, {});

    expect(result.party[0].buffs).toEqual([]);
  });

  it('clears buffs when a character is downed and does not restore them on revive', () => {
    const target = makeChar({
      id: 'hero-1',
      hp: 1,
      buffs: [{ id: 'shield', name: 'Shielded', description: 'A fading ward.', statBonuses: { might: 1 }, remainingTurns: 2 }],
    });
    const session = makeSession({ party: [target], activeCharacterId: 'hero-1' });
    const failedAttempt = { actionAttempt: 'Block the ogre', actionResult: { success: false, roll: 2, statUsed: 'might' as const } };

    const downed = GameEngine.updateState(session, failedAttempt, { suggestedDamage: 1 });
    expect(downed.party[0].status).toBe('downed');
    expect(downed.party[0].buffs).toEqual([]);

    const revived = GameEngine.updateState(downed, { actionAttempt: 'Revive Barnaby', actionResult: { success: true, roll: 20, statUsed: 'magic' as const } }, {
      suggestedRevive: { characterName: 'Barnaby', hp: 3 },
    });
    expect(revived.party[0].status).toBe('active');
    expect(revived.party[0].buffs).toEqual([]);
  });

  it('discards invalid buff suggestions', () => {
    const session = makeSession();
    const attempt = { actionAttempt: 'Bless Nobody', actionResult: { success: true, roll: 16, statUsed: 'magic' as const } };

    const result = GameEngine.updateState(session, attempt, {
      suggestedBuffAdd: [{
        characterName: 'Nobody',
        name: '',
        description: '',
        statBonuses: { magic: 10 },
        remainingTurns: 99,
      }],
    });

    expect(result.party[0].buffs ?? []).toEqual([]);
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

describe('GameEngine.updateState - encounter auto-damage', () => {
  const makeEncounter = (enemyHp = 6): EncounterState => ({
    id: 'enc-1',
    name: 'Goblin Brawl',
    status: 'active',
    round: 1,
    enemies: [
      { id: 'enemy-1', name: 'Goblin', role: 'standard', hp: enemyHp, maxHp: enemyHp, status: 'active' },
    ],
    areas: [],
  });

  it('deals base impact damage on success when AI provides no enemy damage', () => {
    const session = makeSession({ encounterState: makeEncounter() });
    const attempt = { actionAttempt: 'Strike', actionResult: { success: true, roll: 14, statUsed: 'might' as const, impact: 'normal' as const } };
    const result = GameEngine.updateState(session, attempt, {});
    expect(result.encounterState!.enemies[0].hp).toBe(4);
  });

  it('deals strong-impact damage (3) when impact is strong', () => {
    const session = makeSession({ encounterState: makeEncounter() });
    const attempt = { actionAttempt: 'Strike hard', actionResult: { success: true, roll: 18, statUsed: 'might' as const, impact: 'strong' as const } };
    const result = GameEngine.updateState(session, attempt, {});
    expect(result.encounterState!.enemies[0].hp).toBe(3);
  });

  it('deals extreme-impact damage (5) when impact is extreme', () => {
    const session = makeSession({ encounterState: makeEncounter() });
    const attempt = { actionAttempt: 'Devastating blow', actionResult: { success: true, roll: 20, statUsed: 'might' as const, impact: 'extreme' as const } };
    const result = GameEngine.updateState(session, attempt, {});
    expect(result.encounterState!.enemies[0].hp).toBe(1);
  });

  it('does not auto-damage on a failed action', () => {
    const session = makeSession({ encounterState: makeEncounter() });
    const attempt = { actionAttempt: 'Strike', actionResult: { success: false, roll: 4, statUsed: 'might' as const } };
    const result = GameEngine.updateState(session, attempt, {});
    expect(result.encounterState!.enemies[0].hp).toBe(6);
  });

  it('does not auto-damage when statUsed is none', () => {
    const session = makeSession({ encounterState: makeEncounter() });
    const attempt = { actionAttempt: 'Narrate', actionResult: { success: true, roll: 0, statUsed: 'none' as const } };
    const result = GameEngine.updateState(session, attempt, {});
    expect(result.encounterState!.enemies[0].hp).toBe(6);
  });

  it('does not auto-damage for successful healing or support actions', () => {
    const session = makeSession({ encounterState: makeEncounter() });
    const attempt = {
      actionAttempt: 'Invoke a sacred healing prayer toward the party',
      actionResult: { success: true, roll: 15, statUsed: 'magic' as const, impact: 'strong' as const },
    };
    const result = GameEngine.updateState(session, attempt, {
      suggestedHeal: [{ characterName: 'Hero', hp: 4 }],
      suggestedEncounterUpdate: {
        enemyDamage: [{ enemyName: 'Goblin', amount: 3, reason: 'misread healing as harm' }],
      },
    });
    expect(result.encounterState!.enemies[0].hp).toBe(6);
    expect(result.encounterState!.enemies[0].status).toBe('active');
  });

  it('does not auto-damage when encounter is not active', () => {
    const session = makeSession({
      encounterState: { ...makeEncounter(), status: 'defeated' },
    });
    const attempt = { actionAttempt: 'Strike', actionResult: { success: true, roll: 14, statUsed: 'might' as const, impact: 'normal' as const } };
    const result = GameEngine.updateState(session, attempt, {});
    expect(result.encounterState!.status).toBe('defeated');
  });

  it('uses AI-specified enemy damage instead of auto-damage', () => {
    const session = makeSession({ encounterState: makeEncounter() });
    const attempt = { actionAttempt: 'Strike', actionResult: { success: true, roll: 14, statUsed: 'might' as const, impact: 'normal' as const } };
    const result = GameEngine.updateState(session, attempt, {
      suggestedEncounterUpdate: {
        enemyDamage: [{ enemyId: 'enemy-1', enemyName: 'Goblin', amount: 1, reason: 'glancing blow' }],
      },
    });
    expect(result.encounterState!.enemies[0].hp).toBe(5);
  });

  it('resolves the encounter when auto-damage defeats the last enemy', () => {
    const session = makeSession({ encounterState: makeEncounter(2) });
    const attempt = { actionAttempt: 'Finish it', actionResult: { success: true, roll: 14, statUsed: 'might' as const, impact: 'normal' as const } };
    const result = GameEngine.updateState(session, attempt, {});
    expect(result.encounterState!.enemies[0].status).toBe('defeated');
    expect(result.encounterState!.status).toBe('defeated');
  });

  it('ticks DoT effects on active enemies even without AI update', () => {
    const enc: EncounterState = {
      ...makeEncounter(6),
      enemies: [{
        id: 'enemy-1',
        name: 'Goblin',
        role: 'standard',
        hp: 6,
        maxHp: 6,
        status: 'active',
        effects: [{ id: 'ef1', name: 'Burning', description: 'On fire', kind: 'damage_over_time', damagePerTurn: 1, remainingTurns: 2 }],
      }],
    };
    const session = makeSession({ encounterState: enc });
    const attempt = { actionAttempt: 'Wait', actionResult: { success: false, roll: 3, statUsed: 'might' as const } };
    const result = GameEngine.updateState(session, attempt, {});
    expect(result.encounterState!.enemies[0].hp).toBeLessThan(6);
  });

  it('starts a prepared encounter when high-tension narration names a seed enemy but omits suggestedEncounterStart', () => {
    const dmPrepEncounters: EncounterSeed[] = [{
      name: 'Memory Crabs Skirmish',
      triggerHint: 'when party enters the Graying Shore',
      enemies: [{
        name: 'Memory Crab',
        role: 'minion',
        weaknesses: [{ label: 'bright light', school: 'light' }],
        traits: ['swarming', 'quick'],
      }],
      areas: [{ label: 'sandy shore littered with memories', tags: ['beach', 'danger'] }],
      objective: 'defeat the crabs to retrieve lost memories',
      lootHint: 'Compass Medallion',
    }];
    const session = makeSession({ dmPrepEncounters });
    const attempt = {
      actionAttempt: 'Gather your strength for a fight',
      actionResult: { success: false, roll: 6, statUsed: 'might' as const },
    };

    const result = GameEngine.updateState(session, attempt, {
      narration: 'A sudden rustle in the sand reveals a swarm of Memory Crabs.',
      imagePrompt: 'A hero surrounded by swarming Memory Crabs on the Graying Shore.',
      currentTensionLevel: 'high',
      suggestedDamage: 2,
      suggestedEncounterStart: null,
    });

    expect(result.encounterState?.name).toBe('Memory Crabs Skirmish');
    expect(result.encounterState?.enemies[0].name).toBe('Memory Crab');
    expect(result.encounterState?.enemies[0].weaknesses?.[0].label).toBe('bright light');
  });

  it('grants seeded encounter loot once and appends it to narration when the encounter resolves', () => {
    const dmPrepEncounters: EncounterSeed[] = [{
      name: 'Memory Crabs Skirmish',
      triggerHint: 'when party enters the Graying Shore',
      enemies: [{ name: 'Memory Crab', role: 'minion' }],
      areas: [],
      objective: 'defeat the crabs to retrieve lost memories',
      lootHint: 'Compass Medallion',
    }];
    const encounterState: EncounterState = {
      id: 'enc-1',
      name: 'Memory Crabs Skirmish',
      status: 'active',
      round: 1,
      enemies: [{ id: 'enemy-1', name: 'Memory Crab', role: 'minion', hp: 1, maxHp: 2, status: 'active' }],
      areas: [],
    };
    const session = makeSession({ dmPrepEncounters, encounterState });
    const attempt = {
      actionAttempt: 'Strike the final crab',
      actionResult: { success: true, roll: 18, statUsed: 'might' as const, impact: 'normal' as const },
    };
    const aiChanges: Record<string, unknown> = {
      narration: 'The final Memory Crab skitters back and collapses into drifting sparks.',
      suggestedEncounterUpdate: null,
    };

    const result = GameEngine.updateState(session, attempt, aiChanges);

    expect(result.encounterState?.status).toBe('defeated');
    expect(result.party[0].inventory.map(i => i.name)).toContain('Compass Medallion');
    expect(aiChanges.narration).toContain('Barnaby claims Compass Medallion from the aftermath.');
  });

  it('does not duplicate seeded encounter loot already carried by another party member', () => {
    const dmPrepEncounters: EncounterSeed[] = [{
      name: 'Memory Crabs Skirmish',
      triggerHint: 'when party enters the Graying Shore',
      enemies: [{ name: 'Memory Crab', role: 'minion' }],
      areas: [],
      objective: 'defeat the crabs to retrieve lost memories',
      lootHint: 'Compass Medallion',
    }];
    const encounterState: EncounterState = {
      id: 'enc-1',
      name: 'Memory Crabs Skirmish',
      status: 'active',
      round: 1,
      enemies: [{ id: 'enemy-1', name: 'Memory Crab', role: 'minion', hp: 1, maxHp: 2, status: 'active' }],
      areas: [],
    };
    const session = makeSession({
      dmPrepEncounters,
      encounterState,
      party: [
        makeChar({ id: 'hero-1', name: 'Barnaby', inventory: [] }),
        makeChar({ id: 'hero-2', name: 'Mira', inventory: [{ id: 'item-1', name: '🧭 Compass Medallion', description: 'Already found.' }] }),
      ],
    });
    const attempt = {
      actionAttempt: 'Strike the final crab',
      actionResult: { success: true, roll: 18, statUsed: 'might' as const, impact: 'normal' as const },
    };
    const aiChanges: Record<string, unknown> = {
      narration: 'The final Memory Crab skitters back and collapses into drifting sparks.',
      suggestedEncounterUpdate: null,
    };

    const result = GameEngine.updateState(session, attempt, aiChanges);

    expect(result.party.flatMap(c => c.inventory.filter(i => i.name.includes('Compass Medallion')))).toHaveLength(1);
    expect(aiChanges.narration).toBe('The final Memory Crab skitters back and collapses into drifting sparks.');
  });

  it('grants fallback trophy loot for a non-trivial organic encounter on normal difficulty', () => {
    const encounterState: EncounterState = {
      id: 'enc-1',
      name: 'Shadow Ambusher Skirmish',
      status: 'active',
      round: 1,
      enemies: [{ id: 'enemy-1', name: 'Shadow Ambusher', role: 'standard', hp: 1, maxHp: 6, status: 'active' }],
      areas: [],
    };
    const session = makeSession({ encounterState, difficulty: 'normal' });
    const attempt = {
      actionAttempt: 'Strike the ambusher',
      actionResult: { success: true, roll: 16, statUsed: 'magic' as const, impact: 'normal' as const },
    };
    const aiChanges: Record<string, unknown> = {
      narration: 'The bolt drops the Shadow Ambusher.',
      suggestedEncounterUpdate: null,
    };

    const result = GameEngine.updateState(session, attempt, aiChanges);

    expect(result.encounterState?.status).toBe('defeated');
    expect(result.party[0].inventory.map(i => i.name)).toContain('Shadow Ambusher Token');
    expect(aiChanges.narration).toContain('Barnaby claims Shadow Ambusher Token from the aftermath.');
  });

  it('does not grant fallback trophy loot for trivial organic minions', () => {
    const encounterState: EncounterState = {
      id: 'enc-1',
      name: 'Ledger Speck Skirmish',
      status: 'active',
      round: 1,
      enemies: [{ id: 'enemy-1', name: 'Ledger Speck', role: 'minion', hp: 1, maxHp: 1, status: 'active' }],
      areas: [],
    };
    const session = makeSession({ encounterState, difficulty: 'normal' });
    const attempt = {
      actionAttempt: 'Swat the speck',
      actionResult: { success: true, roll: 16, statUsed: 'might' as const, impact: 'normal' as const },
    };

    const result = GameEngine.updateState(session, attempt, {
      narration: 'The Ledger Speck pops like a soap bubble.',
      suggestedEncounterUpdate: null,
    });

    expect(result.encounterState?.status).toBe('defeated');
    expect(result.party[0].inventory).toHaveLength(0);
  });

  it('starts an organic encounter from high-danger combat narration when AI omits suggestedEncounterStart', () => {
    const session = makeSession();
    const attempt = {
      actionAttempt: 'Push through the broken archway',
      actionResult: { success: false, roll: 5, statUsed: 'might' as const },
    };

    const result = GameEngine.updateState(session, attempt, {
      narration: 'A bandit springs from behind the cracked pillar and attacks.',
      imagePrompt: 'A hero facing a sudden bandit ambush in a ruined archway.',
      currentTensionLevel: 'high',
      suggestedDamage: 2,
      suggestedEncounterStart: null,
    });

    expect(result.encounterState?.name).toBe('Bandit Skirmish');
    expect(result.encounterState?.enemies[0].name).toBe('Bandit');
    expect(result.encounterState?.status).toBe('active');
  });

  it('does not start an organic encounter from escape narration and combat-flavored next choices', () => {
    const session = makeSession();
    const attempt = {
      actionAttempt: 'Rinsworth swiftly chants a teleportation spell, aiming to whisk the team outside the crumbling basilica.',
      actionResult: { success: true, roll: 18, statUsed: 'magic' as const, impact: 'extreme' as const },
    };

    const result = GameEngine.updateState(session, attempt, {
      narration: "Rinsworth's teleportation spell whisks the party away just as the basilica begins to collapse. Outside, Vesperine Quill's shadow looms in the distance, her quill poised for a final stroke.",
      imagePrompt: 'Dragonborn bard Durogg stands outside a crumbling basilica, wild magic crackling nearby, tension in the air.',
      choices: [
        { label: 'Confront Vesperine with a defiant battle song', difficulty: 'normal', stat: 'mischief' },
        { label: "Examine the unstable rune's lingering energy for a containment clue", difficulty: 'hard', stat: 'magic' },
      ],
      currentTensionLevel: 'high',
      suggestedDamage: null,
      suggestedEncounterStart: null,
    });

    expect(result.encounterState).toBeUndefined();
  });
});
