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
});
