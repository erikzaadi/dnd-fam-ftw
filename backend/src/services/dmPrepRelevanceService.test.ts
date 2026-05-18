import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractRelevantDmPrep } from './dmPrepRelevanceService.js';

const SHORT_PREP = 'Short prep under 3000 chars.';
const LONG_PREP = 'A'.repeat(3001);

const makeContext = () => ({
  scene: 'A dark dungeon corridor',
  storySummary: 'The heroes seek the ancient tome.',
  recentHistory: ['Goblin ambush defeated.', 'Found a hidden door.', 'Heard distant chanting.'],
});

describe('extractRelevantDmPrep', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns rawDmPrep unchanged when length <= 3000', async () => {
    const result = await extractRelevantDmPrep(SHORT_PREP, makeContext());
    expect(result).toBe(SHORT_PREP);
  });

  it('does not call the model when prep length <= 3000', async () => {
    const createSpy = vi.fn();
    vi.doMock('../providers/ai/openAiClient.js', () => ({
      createOpenAIClient: () => ({ chat: { completions: { create: createSpy } } }),
      getModelForTier: () => 'gpt-4.1-nano',
    }));
    await extractRelevantDmPrep(SHORT_PREP, makeContext());
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('returns extracted output when pre-call succeeds', async () => {
    const extracted = 'The lich seeks the Crystal Heart. Guard captain Mira is a spy. The vault is beneath the chapel.';
    vi.doMock('../providers/ai/openAiClient.js', () => ({
      createOpenAIClient: () => ({
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: extracted } }],
            }),
          },
        },
      }),
      getModelForTier: () => 'gpt-4.1-nano',
    }));
    const { extractRelevantDmPrep: fn } = await import('./dmPrepRelevanceService.js');
    const result = await fn(LONG_PREP, makeContext());
    expect(result).toBe(extracted);
  });

  it('returns slice fallback when pre-call throws', async () => {
    vi.doMock('../providers/ai/openAiClient.js', () => ({
      createOpenAIClient: () => ({
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error('API error')),
          },
        },
      }),
      getModelForTier: () => 'gpt-4.1-nano',
    }));
    const { extractRelevantDmPrep: fn } = await import('./dmPrepRelevanceService.js');
    const result = await fn(LONG_PREP, makeContext());
    expect(result).toBe(LONG_PREP.slice(0, 3000));
  });

  it('returns slice fallback when pre-call returns empty string', async () => {
    vi.doMock('../providers/ai/openAiClient.js', () => ({
      createOpenAIClient: () => ({
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: '' } }],
            }),
          },
        },
      }),
      getModelForTier: () => 'gpt-4.1-nano',
    }));
    const { extractRelevantDmPrep: fn } = await import('./dmPrepRelevanceService.js');
    const result = await fn(LONG_PREP, makeContext());
    expect(result).toBe(LONG_PREP.slice(0, 3000));
  });

  it('returns slice fallback when pre-call exceeds time budget', async () => {
    vi.doMock('../providers/ai/openAiClient.js', () => ({
      createOpenAIClient: () => ({
        chat: {
          completions: {
            create: vi.fn().mockImplementation((_req: unknown, opts: { signal?: AbortSignal }) => {
              return new Promise((_resolve, reject) => {
                if (opts?.signal) {
                  opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
                }
              });
            }),
          },
        },
      }),
      getModelForTier: () => 'gpt-4.1-nano',
    }));
    const { extractRelevantDmPrep: fn } = await import('./dmPrepRelevanceService.js');
    const result = await fn(LONG_PREP, makeContext(), 50);
    expect(result).toBe(LONG_PREP.slice(0, 3000));
  });
});
