import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateService } from '../../services/stateService.js';
import { executeTurnAction } from '../../services/turnService.js';
import { FIXED_NARRATION_OUTPUT, resetMockNarrationProvider } from './mockNarrationProvider.js';
import { choicesForSession, cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createMockNarrationProvider } = await import('./mockNarrationProvider.js');
  return {
    createNarrationProvider: vi.fn(() => createMockNarrationProvider()),
    createChatClient: vi.fn(),
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
});
