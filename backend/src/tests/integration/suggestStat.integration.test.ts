import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewFreeAction, suggestStatForSessionAction } from '../../services/statSuggestionService.js';
import { StateService } from '../../services/stateService.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

const { mockCreateCompletion } = vi.hoisted(() => ({
  mockCreateCompletion: vi.fn(),
}));

vi.mock('../../providers/ai/AiProviderFactory.js', () => ({
  createChatClientForTier: vi.fn(() => ({
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
    });

    expect(suggestion.stat).toBe('magic');
    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    expect(mockCreateCompletion.mock.calls[0][0].messages[0].content).toContain('I conjure a shield of moonlight');
    expect(mockCreateCompletion.mock.calls[0][0].messages[0].content).toContain('The current fantasy RPG character is');
  });

  it('returns character edge preview for social free-text actions', async () => {
    await insertSessionState(makeTestSession({ id: 'suggest-stat-edge-session' }));

    const suggestion = await suggestStatForSessionAction('suggest-stat-edge-session', {
      action: 'I persuade the guard to let everyone pass',
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
    });

    expect(preview).toMatchObject({
      stat: 'magic',
      narration: 'Pip raises a bright shield.',
    });
    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
  });

  it('generates action text when no action is supplied and a support intent is provided', async () => {
    await insertSessionState(makeTestSession({ id: 'preview-generated-action-session' }));
    mockCreateCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '{"generatedAction":"Pip blesses Zara with a flicker of divine light.","stat":"magic","narration":"A warm glow settles over Zara."}' } }],
    });

    const preview = await previewFreeAction('preview-generated-action-session', {
      context: { intent: 'bless_character', targetCharacterId: 'char-zara' },
    });

    expect(preview.generatedAction).toBe('Pip blesses Zara with a flicker of divine light.');
    expect(preview.stat).toBe('magic');
    expect(preview.narration).toBe('A warm glow settles over Zara.');
    expect(mockCreateCompletion).toHaveBeenCalledTimes(1);
    const prompt = mockCreateCompletion.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('bless_character');
    expect(prompt).toContain('generatedAction');
  });

  it('prompts for combined generation+analysis for party_boost intent', async () => {
    await insertSessionState(makeTestSession({ id: 'preview-party-boost-session' }));
    mockCreateCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '{"generatedAction":"Pip rallies everyone with a battle cry.","stat":"mischief","narration":"The party stands taller."}' } }],
    });

    const preview = await previewFreeAction('preview-party-boost-session', {
      context: { intent: 'party_boost' },
    });

    expect(preview.generatedAction).toContain('Pip');
    const prompt = mockCreateCompletion.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('everyone');
    expect(prompt).toContain('party_boost');
  });

  it('falls back gracefully when model returns no generatedAction', async () => {
    await insertSessionState(makeTestSession({ id: 'preview-fallback-session' }));
    mockCreateCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '{"stat":"magic"}' } }],
    });

    const preview = await previewFreeAction('preview-fallback-session', {
      context: { intent: 'aid_character', targetCharacterId: 'char-zara' },
    });

    expect(preview.generatedAction).toBeTruthy();
    expect(preview.stat).toBe('magic');
  });

  it('includes story summary and recent narration in free-text previews', async () => {
    await insertSessionState(makeTestSession({
      id: 'preview-action-context-session',
      storySummary: 'The party promised Mira they would recover the moon key.',
    }));
    await StateService.addTurnResult('preview-action-context-session', {
      narration: 'Pip found silver claw marks beside the locked pantry door.',
      choices: [],
      imagePrompt: null,
      imageSuggested: false,
    }, null);
    mockCreateCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: '{"stat":"mischief","narration":"Pip studies the claw marks."}' } }],
    });

    await previewFreeAction('preview-action-context-session', {
      action: 'Check whether the claw marks fit the key',
    });

    const prompt = mockCreateCompletion.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('The party promised Mira they would recover the moon key.');
    expect(prompt).toContain('Current turn narration:');
    expect(prompt).toContain('Pip found silver claw marks beside the locked pantry door.');
  });
});
