import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractRelevantDmPrep } from './dmPrepRelevanceService.js';

const SHORT_PREP = 'Short prep under 3000 chars.';
const LONG_PREP = 'A'.repeat(3001);

const makeContext = () => ({
  scene: 'A dark dungeon corridor',
  storySummary: 'The heroes seek the ancient tome.',
  recentHistory: ['Goblin ambush defeated.', 'Found a hidden door.', 'Heard distant chanting.'],
});

const mockCreate = vi.fn();

vi.mock('../providers/ai/openAiClient.js', () => ({
  createOpenAIClient: () => ({ chat: { completions: { create: mockCreate } } }),
  getModelForTier: () => 'gpt-4.1-nano',
}));

describe('extractRelevantDmPrep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns rawDmPrep unchanged when length <= 3000', async () => {
    const result = await extractRelevantDmPrep(SHORT_PREP, makeContext());
    expect(result).toBe(SHORT_PREP);
  });

  it('does not call the model when prep length <= 3000', async () => {
    await extractRelevantDmPrep(SHORT_PREP, makeContext());
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns extracted output when pre-call succeeds', async () => {
    const extracted = 'The lich seeks the Crystal Heart. Guard captain Mira is a spy. The vault is beneath the chapel.';
    mockCreate.mockResolvedValue({ choices: [{ message: { content: extracted } }] });
    const result = await extractRelevantDmPrep(LONG_PREP, makeContext());
    expect(result).toBe(extracted);
  });

  it('returns slice fallback when pre-call throws', async () => {
    mockCreate.mockRejectedValue(new Error('API error'));
    const result = await extractRelevantDmPrep(LONG_PREP, makeContext());
    expect(result).toBe(LONG_PREP.slice(0, 3000));
  });

  it('returns slice fallback when pre-call returns empty string', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] });
    const result = await extractRelevantDmPrep(LONG_PREP, makeContext());
    expect(result).toBe(LONG_PREP.slice(0, 3000));
  });

  it('returns slice fallback when pre-call exceeds time budget', async () => {
    mockCreate.mockImplementation((_req: unknown, opts: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }
      })
    );
    const result = await extractRelevantDmPrep(LONG_PREP, makeContext(), 50);
    expect(result).toBe(LONG_PREP.slice(0, 3000));
  });
});
