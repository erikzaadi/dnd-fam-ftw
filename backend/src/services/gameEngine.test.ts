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
  interventionState: { used: false },
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
