import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateService } from '../../services/stateService.js';
import { executeTurnAction } from '../../services/turnService.js';
import { FIXED_NARRATION_OUTPUT, mockGenerateTurn, resetMockNarrationProvider } from './mockNarrationProvider.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

const realtimeMocks = vi.hoisted(() => ({
  broadcastUpdate: vi.fn(),
  broadcastSessionChanged: vi.fn(),
}));

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createMockNarrationProvider } = await import('./mockNarrationProvider.js');
  return {
    createNarrationProvider: vi.fn(() => createMockNarrationProvider()),
    createChatClientForTier: vi.fn(),
  };
});

vi.mock('../../realtime/sessionEvents.js', () => ({
  broadcastUpdate: realtimeMocks.broadcastUpdate,
  broadcastSessionChanged: realtimeMocks.broadcastSessionChanged,
}));

let paths: IntegrationTestPaths;

beforeAll(() => {
  paths = setupIntegrationEnvironment('free-action');
});

beforeEach(() => {
  resetMockNarrationProvider();
  realtimeMocks.broadcastUpdate.mockReset();
  realtimeMocks.broadcastSessionChanged.mockReset();
});

afterAll(() => {
  cleanupIntegrationEnvironment(paths);
});

describe('executeTurnAction free action integration', () => {
  it('preserves custom action text, calls narration once, and persists the turn', async () => {
    const session = makeTestSession({
      id: 'free-action-session',
      party: [makeTestSession().party[0]],
      activeCharacterId: 'char-pip',
    });
    await insertSessionState(session);

    const action = 'I try to bribe the guard with a shiny coin';
    const result = await executeTurnAction('free-action-session', 'local', {
      action,
      statUsed: 'mischief',
      difficulty: 'easy',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.body.actionAttempt.actionAttempt).toBe(action);
    expect(mockGenerateTurn).toHaveBeenCalledTimes(1);
    expect(mockGenerateTurn.mock.calls[0][0].actionAttempt).toBe(action);
    expect(result.body.turnResult.narration).toBe(FIXED_NARRATION_OUTPUT.narration);
    expect(result.body.turnResult.choices).toHaveLength(3);
    expect(result.body.turnResult.imagePrompt).toBeNull();
    expect(result.body.turnResult.imageSuggested).toBe(false);

    const stored = await StateService.getSession('free-action-session');
    expect(stored?.turn).toBe(2);
    expect(stored?.activeCharacterId).toBe('char-pip');
  });

  it('replaces stale combat narration and choices when auto-damage resolves an encounter', async () => {
    resetMockNarrationProvider({
      ...FIXED_NARRATION_OUTPUT,
      narration: 'The Ambusher snarls, wounded but fierce, lunging at Zara.',
      choices: [
        { label: 'Cast a precise missile at the Ambusher', difficulty: 'normal', stat: 'magic', difficultyValue: 13 },
        { label: 'Dive away from the Ambusher', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
        { label: 'Distract the Ambusher', difficulty: 'hard', stat: 'mischief', difficultyValue: 15 },
      ],
      currentTensionLevel: 'high',
    });
    const session = makeTestSession({
      id: 'free-action-resolved-encounter-session',
      party: [makeTestSession().party[0], makeTestSession().party[1]],
      activeCharacterId: 'char-pip',
      storySummary: 'STORY SO FAR: The party is in a vault.\nNEXT PROMISED BEAT: Decipher the fractured runic entrance and confront the Ledger doorway.',
      encounterState: {
        id: 'enc-ambusher',
        name: 'Ambusher Skirmish',
        status: 'active',
        round: 1,
        enemies: [{ id: 'enemy-ambusher', name: 'Ambusher', role: 'standard', hp: 1, maxHp: 6, status: 'active' }],
        areas: [],
      },
    });
    await insertSessionState(session);

    const result = await executeTurnAction('free-action-resolved-encounter-session', 'local', {
      action: 'Pip strikes the Ambusher with a precise blade thrust',
      statUsed: 'magic',
      difficulty: 'easy',
      difficultyValue: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.body.turnResult.narration).toContain('Ambusher collapses, defeated');
    const lootChange = result.body.turnResult.inventoryChanges?.find(
      (c: { characterName: string; type: string }) => c.characterName === 'Pip' && c.type === 'added'
    );
    expect(lootChange).toBeTruthy();
    const lootName = (lootChange!.itemName) as string;
    expect(result.body.turnResult.narration).toContain(`Pip claims ${lootName} from the aftermath`);
    expect(result.body.turnResult.narration).toContain(`${lootName} still hums with usable magic.`);
    expect(result.body.turnResult.narration).toContain('Now the party can decipher the fractured runic entrance and confront the Ledger doorway.');
    expect(result.body.turnResult.narration).not.toContain('wounded but fierce');
    expect(result.body.turnResult.choices.map(choice => choice.label).join(' ')).not.toContain('Ambusher');
    expect(result.body.turnResult.choices.map(choice => choice.label)).toEqual([
      'Push beyond the battlefield',
      `Empower ${lootName}`,
      'Stabilize the scene with magic',
    ]);
    expect(result.body.turnResult.choices[1]).toMatchObject({
      stat: 'magic',
      difficultyValue: 12,
      flavor: 'standard',
    });
    expect(result.body.turnResult.choices[2].environmentFeature).toBe('A goblin kitchen');
    expect(result.body.turnResult.inventoryChanges).toContainEqual({
      characterName: 'Pip',
      itemName: lootName,
      type: 'added',
    });
    expect(result.body.turnResult.encounterEnemyChanges?.[0]).toMatchObject({
      enemyName: 'Ambusher',
      newStatus: 'defeated',
    });
    const stored = await StateService.getSession('free-action-resolved-encounter-session');
    expect(stored?.party[0].inventory.map(item => item.name)).toContain(lootName);
    expect(stored?.lastChoices.map(choice => choice.label).join(' ')).not.toContain('Ambusher');
  });

  it('resolves typed correct riddle answers without rolling', async () => {
    const session = makeTestSession({
      id: 'free-action-riddle-session',
      party: [makeTestSession().party[0]],
      activeCharacterId: 'char-pip',
    });
    await insertSessionState(session);
    await StateService.addTurnResult('free-action-riddle-session', {
      narration: 'Fiddlewick asks, "What runs but never walks?"',
      choices: [
        { label: 'Answer: a river', difficulty: 'normal', stat: 'mischief', difficultyValue: 12, riddleAnswer: 'a river', riddleCorrect: true },
        { label: 'Answer: a shadow', difficulty: 'normal', stat: 'mischief', difficultyValue: 12, riddleAnswer: 'a shadow', riddleCorrect: false },
        { label: 'Ask for a hint', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
      ],
      imagePrompt: null,
      imageSuggested: false,
    }, null);

    const result = await executeTurnAction('free-action-riddle-session', 'local', {
      action: 'Solve the riddle with the answer: "A river"',
      statUsed: 'mischief',
      difficulty: 'normal',
      difficultyValue: 12,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.body.actionAttempt.actionResult).toMatchObject({ success: true, roll: 0, statUsed: 'none' });
    expect(mockGenerateTurn.mock.calls[0][0].actionResult).toMatchObject({ success: true, statUsed: undefined });
  });

  it('infers helper and item bonuses from valid free-text references', async () => {
    const base = makeTestSession();
    const session = makeTestSession({
      id: 'free-action-bonus-session',
      party: [
        base.party[0],
        {
          ...base.party[1],
          inventory: [{ id: 'scroll-1', name: '📜 Enchanted Scroll', description: 'A protective spell', transferable: true, consumable: false }],
        },
      ],
      activeCharacterId: 'char-pip',
    });
    await insertSessionState(session);

    const result = await executeTurnAction('free-action-bonus-session', 'local', {
      action: 'Ask Zara to use the Enchanted Scroll while Pip slips past the guard',
      statUsed: 'mischief',
      difficulty: 'normal',
      difficultyValue: 14,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.body.actionAttempt.actionResult.helperBonus).toBe(2);
    expect(result.body.actionAttempt.actionResult.helperCharacterName).toBe('Zara');
    expect(result.body.actionAttempt.actionResult.choiceItemBonus).toBe(2);
    expect(result.body.actionAttempt.actionResult.choiceItemName).toBe('📜 Enchanted Scroll');
    expect(result.body.actionAttempt.actionResult.choiceItemOwnerName).toBe('Zara');
    expect(result.body.actionAttempt.actionResult.characterBonus).toBeUndefined();
  });

  it('broadcasts dm_narrating with the same inferred free-text preview metadata', async () => {
    const base = makeTestSession();
    const session = makeTestSession({
      id: 'free-action-sse-preview-session',
      party: [
        base.party[0],
        {
          ...base.party[1],
          inventory: [{ id: 'scroll-1', name: '📜 Enchanted Scroll', description: 'A protective spell', transferable: true, consumable: false }],
        },
      ],
      activeCharacterId: 'char-pip',
    });
    await insertSessionState(session);

    const result = await executeTurnAction('free-action-sse-preview-session', 'local', {
      action: 'Ask Zara to use the Enchanted Scroll while Pip slips past the guard',
      statUsed: 'mischief',
      difficulty: 'normal',
      difficultyValue: 14,
    });

    expect(result.ok).toBe(true);
    const narratingCall = realtimeMocks.broadcastUpdate.mock.calls.find(call => call[1] === 'dm_narrating');
    expect(narratingCall).toBeTruthy();
    expect(narratingCall?.[2]).toMatchObject({
      action: 'Ask Zara to use the Enchanted Scroll while Pip slips past the guard',
      statUsed: 'mischief',
      difficulty: 'normal',
      difficultyValue: 14,
      helperBonus: 2,
      helperCharacterName: 'Zara',
      choiceItemBonus: 2,
      choiceItemName: '📜 Enchanted Scroll',
      choiceItemOwnerName: 'Zara',
    });
  });

  it('infers character edge from social and spotlight free-text actions', async () => {
    const session = makeTestSession({
      id: 'free-action-edge-session',
      party: [makeTestSession().party[0]],
      activeCharacterId: 'char-pip',
    });
    await insertSessionState(session);

    const socialResult = await executeTurnAction('free-action-edge-session', 'local', {
      action: 'Charm the guard with a warm halfling smile',
      statUsed: 'mischief',
      difficulty: 'normal',
      difficultyValue: 14,
    });

    expect(socialResult.ok).toBe(true);
    if (!socialResult.ok) {
      return;
    }

    expect(socialResult.body.actionAttempt.actionResult.characterBonus).toBe(2);
    expect(socialResult.body.actionAttempt.actionResult.characterBonusLabel).toBe('social edge');

    const stored = await StateService.getSession('free-action-edge-session');
    expect(stored).toBeTruthy();
    if (!stored) {
      return;
    }
    stored.activeCharacterId = 'char-pip';
    await StateService.updateSession('free-action-edge-session', stored);

    const spotlightResult = await executeTurnAction('free-action-edge-session', 'local', {
      action: 'Use Pip the Rogue training to vanish into the shadow',
      statUsed: 'mischief',
      difficulty: 'normal',
      difficultyValue: 14,
    });

    expect(spotlightResult.ok).toBe(true);
    if (!spotlightResult.ok) {
      return;
    }

    expect(spotlightResult.body.actionAttempt.actionResult.characterBonus).toBe(2);
    expect(spotlightResult.body.actionAttempt.actionResult.characterBonusLabel).toBe('spotlight');
  });
});
