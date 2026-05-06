import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateService } from '../../services/stateService.js';
import { executeTurnAction } from '../../services/turnService.js';
import { FIXED_NARRATION_OUTPUT, mockGenerateTurn, resetMockNarrationProvider } from './mockNarrationProvider.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createMockNarrationProvider } = await import('./mockNarrationProvider.js');
  return {
    createNarrationProvider: vi.fn(() => createMockNarrationProvider()),
    createChatClient: vi.fn(),
  };
});

let paths: IntegrationTestPaths;

beforeAll(() => {
  paths = setupIntegrationEnvironment('free-action');
});

beforeEach(() => {
  resetMockNarrationProvider();
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
});
