import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { suggestStatForSessionAction } from '../../services/statSuggestionService.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

const { mockCreateCompletion } = vi.hoisted(() => ({
  mockCreateCompletion: vi.fn(),
}));

vi.mock('../../providers/ai/AiProviderFactory.js', () => ({
  createChatClient: vi.fn(() => ({
    client: {
      chat: {
        completions: {
          create: mockCreateCompletion,
        },
      },
    },
    model: 'mock-chat',
  })),
  createNarrationProvider: vi.fn(),
}));

let paths: IntegrationTestPaths;

beforeAll(() => {
  paths = setupIntegrationEnvironment('suggest-stat');
});

beforeEach(() => {
  mockCreateCompletion.mockReset();
  mockCreateCompletion.mockResolvedValue({
    choices: [{ message: { content: 'magic' } }],
  });
});

afterAll(() => {
  cleanupIntegrationEnvironment(paths);
});

describe('suggest-stat integration', () => {
  it('uses the chat client and returns the parsed stat for a custom action', async () => {
    await insertSessionState(makeTestSession({ id: 'suggest-stat-session' }));

    const stat = await suggestStatForSessionAction('suggest-stat-session', {
      action: 'I conjure a shield of moonlight',
      characterClass: 'Wizard',
      characterQuirk: 'Talks to books',
    });

    expect(stat).toBe('magic');
    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    expect(mockCreateCompletion.mock.calls[0][0].messages[0].content).toContain('I conjure a shield of moonlight');
  });
});
