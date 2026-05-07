import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NarrationInput, NarrationOutput } from './NarrationProvider.js';

const mocks = vi.hoisted(() => {
  const create = vi.fn();
  const OpenAI = vi.fn(function OpenAIMock() {
    return {
      chat: {
        completions: {
          create,
        },
      },
    };
  });
  return { OpenAI, create };
});

vi.mock('openai', () => ({
  default: mocks.OpenAI,
}));

import { OpenAINarrationProvider } from './OpenAINarrationProvider.js';

const input: NarrationInput = {
  scene: 'A ruined keep',
  party: [
    { name: 'Pip', class: 'Rogue', species: 'Halfling', hp: 8, maxHp: 8, status: 'active' },
  ],
  inventory: [],
  actionAttempt: 'Search the hall',
  actionResult: { success: true, summary: 'The action succeeded.' },
  recentHistory: [],
  tone: 'playful',
  gameMode: 'fast',
};

const output = (overrides: Partial<NarrationOutput> = {}): NarrationOutput => ({
  narration: 'Pip finds a cracked staircase leading deeper into the keep.',
  choices: [
    { label: 'Follow the stairs', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
    { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
    { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
  ],
  rollNarration: 'No roll was needed.',
  imagePrompt: null,
  imageSuggested: false,
  currentTensionLevel: 'medium',
  suggestedInventoryAdd: null,
  suggestedInventoryRemove: null,
  suggestedInventoryUpdate: null,
  suggestedRevive: null,
  suggestedHeal: null,
  suggestedDamage: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.OPENAI_BASE_URL;
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
});

describe('OpenAINarrationProvider', () => {
  it('retries on schema failure and returns the corrected response', async () => {
    const malformed = { narration: 'Pip charges forward.', choices: 'not-an-array' };
    const corrected = output({
      narration: 'Pip finds a safer stairwell and marks the old stones with chalk.',
      choices: [
        { label: 'Follow the marked stairwell', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
        { label: 'Question the echoing voices', difficulty: 'normal', stat: 'mischief', difficultyValue: 10 },
        { label: 'Guard the party', difficulty: 'normal', stat: 'might', difficultyValue: 11 },
      ],
    });

    mocks.create
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(malformed) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(corrected) } }] });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const result = await new OpenAINarrationProvider().generateTurn(input);
      const retryRequest = mocks.create.mock.calls[1]?.[0] as { messages: Array<{ content: string }> } | undefined;

      expect(result).toMatchObject(corrected);
      expect(result.narrationRetried).toBe(true);
      expect(result.narrationFailed).toBeUndefined();
      expect(mocks.create).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(
        '[OpenAINarration] First attempt failed validation, retrying...',
        expect.any(String)
      );
      expect(retryRequest?.messages[0].content).toContain('fix these validation errors');
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
