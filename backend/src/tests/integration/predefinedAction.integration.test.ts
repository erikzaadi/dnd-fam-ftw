import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionAttempt, TurnResult } from '../../types.js';
import { GameEngine } from '../../services/gameEngine.js';
import { StateService } from '../../services/stateService.js';
import { executeTurnAction } from '../../services/turnService.js';
import { FIXED_NARRATION_OUTPUT, mockGenerateTurn, resetMockNarrationProvider } from './mockNarrationProvider.js';
import { choicesForSession, cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createMockNarrationProvider } = await import('./mockNarrationProvider.js');
  return {
    createNarrationProvider: vi.fn(() => createMockNarrationProvider()),
    createChatClientForTier: vi.fn(),
  };
});

let paths: IntegrationTestPaths;

beforeAll(() => {
  paths = setupIntegrationEnvironment('predefined-action');
});

beforeEach(() => {
  resetMockNarrationProvider();
});

afterAll(() => {
  cleanupIntegrationEnvironment(paths);
});

describe('executeTurnAction predefined action integration', () => {
  it('resolves a suggested choice, writes the turn, and rotates active character', async () => {
    const session = makeTestSession({
      id: 'predefined-action-session',
      lastChoices: choicesForSession(),
    });
    await insertSessionState(session);

    const result = await executeTurnAction('predefined-action-session', 'local', {
      action: 'Press the attack',
      statUsed: 'might',
      difficulty: 'normal',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.body.actionAttempt.actionAttempt).toBe('Press the attack');
    expect(result.body.actionAttempt.actionResult.statUsed).toBe('might');
    expect(result.body.actionAttempt.actionResult.roll).toBeGreaterThanOrEqual(1);
    expect(result.body.actionAttempt.actionResult.roll).toBeLessThanOrEqual(20);
    expect(result.body.turnResult.narration).toBe(FIXED_NARRATION_OUTPUT.narration);
    expect(result.body.turnResult.choices).toHaveLength(3);
    expect(result.body.turnResult.lastAction?.actionAttempt).toBe('Press the attack');
    expect(result.body.turnResult.characterId).toBe('char-pip');

    const stored = await StateService.getSession('predefined-action-session');
    expect(stored?.turn).toBe(2);
    expect(stored?.activeCharacterId).toBe('char-zara');

    const history = await StateService.getTurnHistory('predefined-action-session');
    expect(history).toHaveLength(1);
    expect(history[0].narration).toBe(FIXED_NARRATION_OUTPUT.narration);
    expect(history[0].lastAction?.actionAttempt).toBe('Press the attack');
  });

  it('passes victory-exit momentum into narration after repeated successful combat beats', async () => {
    const session = makeTestSession({
      id: 'predefined-action-victory-exit-session',
      scene: 'A kitchen fight with animated pans',
      lastChoices: choicesForSession(),
    });
    await insertSessionState(session);

    await StateService.addTurnResult('predefined-action-victory-exit-session', makeHistoryTurn({
      narration: 'Pip drove an animated pan into the flour barrel.',
      actionAttempt: 'Strike the animated pan',
      difficultyTarget: 12,
    }), 'char-pip');

    const resolvedAction: ActionAttempt = {
      actionAttempt: 'Press the attack',
      actionResult: {
        success: true,
        roll: 17,
        statUsed: 'might',
        statBonus: 2,
        impact: 'strong',
        difficultyTarget: 12,
      },
    };
    const resolveSpy = vi.spyOn(GameEngine, 'resolveAction').mockReturnValue(resolvedAction);

    try {
      const result = await executeTurnAction('predefined-action-victory-exit-session', 'local', {
        action: 'Press the attack',
        statUsed: 'might',
        difficulty: 'normal',
        difficultyValue: 12,
      });

      expect(result.ok).toBe(true);
      expect(mockGenerateTurn).toHaveBeenCalledTimes(1);
      expect(mockGenerateTurn.mock.calls[0]?.[0].sceneMomentum).toMatchObject({
        directive: 'victory_exit',
        justCompletedCombat: true,
      });
    } finally {
      resolveSpy.mockRestore();
    }
  });

  it('passes victory-exit momentum into narration after a hard challenge is completed', async () => {
    const session = makeTestSession({
      id: 'predefined-action-hard-challenge-session',
      scene: 'A rune bridge challenge blocks the road',
      lastChoices: [
        { label: 'Disarm the rune bridge', difficulty: 'hard', stat: 'magic', difficultyValue: 15 },
        { label: 'Brace the shaking stones', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
        { label: 'Look for a side path', difficulty: 'normal', stat: 'mischief', difficultyValue: 12 },
      ],
    });
    await insertSessionState(session);

    const resolvedAction: ActionAttempt = {
      actionAttempt: 'Disarm the rune bridge',
      actionResult: {
        success: true,
        roll: 18,
        statUsed: 'magic',
        statBonus: 5,
        impact: 'strong',
        difficultyTarget: 15,
      },
    };
    const resolveSpy = vi.spyOn(GameEngine, 'resolveAction').mockReturnValue(resolvedAction);

    try {
      const result = await executeTurnAction('predefined-action-hard-challenge-session', 'local', {
        action: 'Disarm the rune bridge',
        statUsed: 'magic',
        difficulty: 'hard',
        difficultyValue: 15,
      });

      expect(result.ok).toBe(true);
      expect(mockGenerateTurn).toHaveBeenCalledTimes(1);
      expect(mockGenerateTurn.mock.calls[0]?.[0].sceneMomentum).toMatchObject({
        directive: 'victory_exit',
        justCompletedDifficultChallenge: true,
      });
    } finally {
      resolveSpy.mockRestore();
    }
  });

  it('persists only the safe fallback turn when narration fails after guard retry', async () => {
    const session = makeTestSession({
      id: 'predefined-action-fallback-persist-session',
      scene: 'The Crimson Cliffs',
      lastChoices: [
        { label: 'Charge down the narrow path', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
        { label: 'Search the cliffside', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Read the cliff magic', difficulty: 'normal', stat: 'magic', difficultyValue: 12 },
      ],
    });
    await insertSessionState(session);

    resetMockNarrationProvider({
      narration: 'Pip presses into The Crimson Cliffs after the path opens.',
      choices: [
        { label: 'Press deeper into The Crimson Cliffs', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
        { label: 'Search The Crimson Cliffs for a clue', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Read the magic around The Crimson Cliffs', difficulty: 'normal', stat: 'magic', difficultyValue: 12 },
      ],
      currentTensionLevel: 'medium',
      suggestedInventoryAdd: null,
      suggestedInventoryRemove: null,
      suggestedInventoryUpdate: null,
      suggestedRevive: null,
      suggestedHeal: null,
      suggestedBuffAdd: null,
      suggestedBuffRemove: null,
      suggestedDamage: null,
      suggestedEncounterStart: null,
      suggestedEncounterUpdate: null,
      narrationRetried: true,
      narrationFailed: true,
      narrationValidationError: 'Rejected raw story about a portal.',
      narrationRetryValidationError: 'Rejected raw story about a cavern.',
    });

    const result = await executeTurnAction('predefined-action-fallback-persist-session', 'local', {
      action: 'Charge down the narrow path',
      statUsed: 'might',
      difficulty: 'normal',
      difficultyValue: 12,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.body.turnResult.narration).toBe('Pip presses into The Crimson Cliffs after the path opens.');
    expect(result.body.turnResult.narrationFailed).toBe(true);

    const history = await StateService.getTurnHistory('predefined-action-fallback-persist-session');
    expect(history).toHaveLength(1);
    expect(history[0].narration).toBe('Pip presses into The Crimson Cliffs after the path opens.');
    expect(history[0].choices.map(choice => choice.label)).toEqual([
      'Press deeper into The Crimson Cliffs',
      'Search The Crimson Cliffs for a clue',
      'Read the magic around The Crimson Cliffs',
    ]);
    expect(history[0].narrationFailed).toBe(true);
    expect(history[0].narrationValidationError).toBe('Rejected raw story about a portal.');
    expect(history[0].narrationRetryValidationError).toBe('Rejected raw story about a cavern.');
    expect(history[0].narration).not.toContain('portal');
    expect(history[0].narration).not.toContain('cavern');
  });
});

const makeHistoryTurn = (lastAction: {
  narration: string;
  actionAttempt: string;
  difficultyTarget: number;
}): TurnResult => ({
  narration: lastAction.narration,
  choices: [
    { label: 'Press the attack', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
    { label: 'Search the kitchen', difficulty: 'normal', stat: 'mischief', difficultyValue: 12 },
    { label: 'Cast a ward', difficulty: 'normal', stat: 'magic', difficultyValue: 12 },
  ],
  imagePrompt: null,
  imageSuggested: false,
  currentTensionLevel: 'high',
  lastAction: {
    actionAttempt: lastAction.actionAttempt,
    actionResult: {
      success: true,
      roll: 16,
      statUsed: 'might',
      statBonus: 2,
      impact: 'strong',
      difficultyTarget: lastAction.difficultyTarget,
    },
  },
});
