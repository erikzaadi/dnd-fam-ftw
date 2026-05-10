import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewFreeAction, suggestStatForSessionAction } from '../../services/statSuggestionService.js';
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

    const suggestion = await suggestStatForSessionAction('suggest-stat-session', {
      action: 'I conjure a shield of moonlight',
      characterClass: 'Wizard',
      characterQuirk: 'Talks to books',
    });

    expect(suggestion.stat).toBe('magic');
    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    expect(mockCreateCompletion.mock.calls[0][0].messages[0].content).toContain('I conjure a shield of moonlight');
  });

  it('returns character edge preview for social free-text actions', async () => {
    await insertSessionState(makeTestSession({ id: 'suggest-stat-edge-session' }));

    const suggestion = await suggestStatForSessionAction('suggest-stat-edge-session', {
      action: 'I persuade the guard to let everyone pass',
      characterClass: 'Rogue',
      characterQuirk: 'Talks to books',
    });

    expect(suggestion).toMatchObject({
      stat: 'magic',
      characterBonus: 2,
      characterBonusLabel: 'social edge',
      flavor: 'social',
    });
  });

  it('treats party healing free-text actions as social support', async () => {
    await insertSessionState(makeTestSession({ id: 'suggest-stat-heal-session' }));

    const suggestion = await suggestStatForSessionAction('suggest-stat-heal-session', {
      action: 'Heal the entire party',
      characterClass: 'Cleric',
      characterQuirk: 'Hums lullabies',
    });

    expect(suggestion).toMatchObject({
      stat: 'magic',
      characterBonus: 2,
      characterBonusLabel: 'social edge',
      flavor: 'social',
    });
  });

  it('treats party teleport free-text actions as social support', async () => {
    await insertSessionState(makeTestSession({ id: 'suggest-stat-teleport-session' }));

    const suggestion = await suggestStatForSessionAction('suggest-stat-teleport-session', {
      action: 'Teleport the party using your magic through the portal',
      characterClass: 'Mage',
      characterQuirk: 'Times every spell with a wink',
    });

    expect(suggestion).toMatchObject({
      stat: 'magic',
      characterBonus: 2,
      characterBonusLabel: 'social edge',
      flavor: 'social',
    });
  });

  it('returns preview action metadata for typed confirmation', async () => {
    await insertSessionState(makeTestSession({ id: 'preview-action-session' }));
    mockCreateCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '{"stat":"magic","narration":"Pip raises a bright shield."}' } }],
    });

    const preview = await previewFreeAction('preview-action-session', {
      action: 'Cast a shield of moonlight',
      characterClass: 'Wizard',
      characterQuirk: 'Talks to books',
    });

    expect(preview).toMatchObject({
      stat: 'magic',
      narration: 'Pip raises a bright shield.',
    });
    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
  });
});
