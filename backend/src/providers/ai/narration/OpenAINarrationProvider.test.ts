import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NarrationInput, NarrationOutput } from './NarrationProvider.js';

const mocks = vi.hoisted(() => {
  const stream = vi.fn();
  const OpenAI = vi.fn(function OpenAIMock() {
    return {
      chat: {
        completions: {
          stream,
        },
      },
    };
  });
  return { OpenAI, stream };
});

function mockStream(completionValue: unknown) {
  mocks.stream.mockReturnValueOnce({
    on: vi.fn(),
    finalChatCompletion: vi.fn().mockResolvedValue(completionValue),
  });
}

function mockStreamWithContent(completionValue: unknown, snapshots: string[]) {
  mocks.stream.mockReturnValueOnce({
    on: vi.fn((event: string, callback: (delta: string, snapshot: string) => void) => {
      if (event === 'content') {
        for (const snapshot of snapshots) {
          callback('', snapshot);
        }
      }
    }),
    finalChatCompletion: vi.fn().mockResolvedValue(completionValue),
  });
}

vi.mock('openai', () => ({
  default: mocks.OpenAI,
}));

import { OpenAINarrationProvider } from './OpenAINarrationProvider.js';
import { buildNarrationFallback } from './narrationFallback.js';
import { parseNarrationOutput } from './narrationOutputGuards.js';

const input: NarrationInput = {
  scene: 'A ruined keep',
  party: [
    { name: 'Pip', class: 'Rogue', species: 'Halfling', hp: 8, maxHp: 8, stats: { might: 2, magic: 1, mischief: 5 }, status: 'active' },
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
  delete process.env.OPENAI_MODEL_NARRATION;
  delete process.env.OPENAI_REASONING_EFFORT_NARRATION;
  delete process.env.OPENAI_TEXT_VERBOSITY_NARRATION;
  delete process.env.OPENAI_SERVICE_TIER_NARRATION;
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

    mockStream({ choices: [{ message: { parsed: malformed } }] });
    mockStream({ choices: [{ message: { parsed: corrected } }] });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const result = await new OpenAINarrationProvider().generateTurn(input);
      const retryRequest = mocks.stream.mock.calls[1]?.[0] as { messages: Array<{ content: string }> } | undefined;

      expect(result).toMatchObject(corrected);
      expect(result.narrationRetried).toBe(true);
      expect(result.narrationFailed).toBeUndefined();
      expect(mocks.stream).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(
        '[Narration] attempt-1 guard=fail retrying',
        expect.any(String)
      );
      expect(retryRequest?.messages[1].content).toContain('fix this validation error');
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('retries when momentum guard rejects a stalled victory exit', async () => {
    const stalledVictory = output({
      narration: 'Pip wins the fight and the room goes quiet.',
      choices: [
        { label: 'Attack again', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
        { label: 'Strike the last enemy', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
        { label: 'Fight through the room', difficulty: 'hard', stat: 'might', difficultyValue: 16 },
      ],
    });
    const movedForward = output({
      narration: 'Pip wins the fight, then follows a warm draft through the cracked archway into a lantern-lit map room.',
      choices: [
        { label: 'Study the map room', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
        { label: 'Follow the warm draft', difficulty: 'normal', stat: 'magic', difficultyValue: 11 },
        { label: 'Guard the cracked archway', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
      ],
    });

    mockStream({ choices: [{ message: { parsed: stalledVictory } }] });
    mockStream({ choices: [{ message: { parsed: movedForward } }] });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const result = await new OpenAINarrationProvider().generateTurn({
        ...input,
        recentHistory: ['Pip dodged flying pans.', 'Zara pinned the last foe with silver light.'],
        sceneMomentum: {
          directive: 'victory_exit',
          staleChoiceCount: 0,
          turnsSinceSceneChange: 3,
          turnsSinceCombat: 0,
          justCompletedCombat: true,
          justCompletedDifficultChallenge: false,
          suggestedNextBeat: 'Move from the resolved fight into the next clue, route, reward, threat, or decision.',
          reason: 'Combat has already had enough successful beats.',
        },
      });
      const retryRequest = mocks.stream.mock.calls[1]?.[0] as { messages: Array<{ content: string }> } | undefined;

      expect(result).toMatchObject(movedForward);
      expect(result.narrationRetried).toBe(true);
      expect(result.narrationValidationError).toContain('Victory exit');
      expect(mocks.stream).toHaveBeenCalledTimes(2);
      expect(retryRequest?.messages[1].content).toContain('Victory exit');
      expect(retryRequest?.messages[1].content).toContain('At least two choices must act inside that new beat');
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('uses a contextual fallback when both attempts fail validation', async () => {
    const malformed = { narration: 'Pip charges forward.', choices: 'not-an-array' };

    mockStream({ choices: [{ message: { parsed: malformed } }] });
    mockStream({ choices: [{ message: { parsed: malformed } }] });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const result = await new OpenAINarrationProvider().generateTurn({
        ...input,
        scene: 'The Crimson Cliffs',
        actingCharacterName: 'Pip',
        nextCharacterName: 'Zara',
        actionAttempt: 'Charge down the narrow path',
      });

      expect(result.narration).toContain('Pip');
      expect(result.narration).toContain('Charge down the narrow path');
      expect(result.narration).toContain('The Crimson Cliffs');
      expect(result.choices.map(choice => choice.label)).toEqual([
        'Press deeper into The Crimson Cliffs',
        'Search The Crimson Cliffs for a clue',
        'Read the magic around The Crimson Cliffs',
      ]);
      expect(result.choices.map(choice => choice.label)).not.toContain('Inspect the area');
      expect(result.choices.map(choice => choice.label)).not.toContain('Talk to someone nearby');
      expect(result.choices.map(choice => choice.label)).not.toContain('Use your magic');
      expect(result.narrationRetried).toBe(true);
      expect(result.narrationFailed).toBe(true);
      expect(mocks.stream).toHaveBeenCalledTimes(2);
      expect(error).toHaveBeenCalledWith(
        '[OpenAINarration] Retry also failed, using fallback.',
        expect.any(String),
        'Raw:',
        JSON.stringify(malformed)
      );
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('uses the contextual fallback when gameplay guards still reject the retry', async () => {
    const stalledVictory = output({
      narration: 'Pip wins the fight and the room goes quiet.',
      choices: [
        { label: 'Attack again', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
        { label: 'Strike the last enemy', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
        { label: 'Fight through the room', difficulty: 'hard', stat: 'might', difficultyValue: 16 },
      ],
    });

    mockStream({ choices: [{ message: { parsed: stalledVictory } }] });
    mockStream({ choices: [{ message: { parsed: stalledVictory } }] });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const result = await new OpenAINarrationProvider().generateTurn({
        ...input,
        recentHistory: ['Pip dodged flying pans.', 'Zara pinned the last foe with silver light.'],
        sceneMomentum: {
          directive: 'victory_exit',
          staleChoiceCount: 0,
          turnsSinceSceneChange: 3,
          turnsSinceCombat: 0,
          justCompletedCombat: true,
          justCompletedDifficultChallenge: false,
          suggestedNextBeat: 'Move from the resolved fight into the next clue, route, reward, threat, or decision.',
          reason: 'Combat has already had enough successful beats.',
        },
      });

      expect(result.narration).toContain('A way forward opens beyond A ruined keep');
      expect(result.narration).not.toContain('Move from the resolved fight');
      expect(result.choices.map(choice => choice.label)).toEqual([
        'Press deeper into A ruined keep',
        'Search A ruined keep for a clue',
        'Read the magic around A ruined keep',
      ]);
      expect(result.narrationRetried).toBe(true);
      expect(result.narrationFailed).toBe(true);
      expect(result.narrationValidationError).toContain('Victory exit');
      expect(result.narrationRetryValidationError).toContain('Victory exit');
      expect(error).toHaveBeenCalledWith(
        '[OpenAINarration] Retry also failed, using fallback.',
        expect.any(String),
        'Raw:',
        JSON.stringify(stalledVictory),
      );
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('does not leak scene momentum instructions into fallback narration', async () => {
    const result = buildNarrationFallback({
      ...input,
      actionAttempt: 'Strum a rallying song',
      sceneMomentum: {
        directive: 'climax_pressure',
        staleChoiceCount: 0,
        turnsSinceSceneChange: 5,
        turnsSinceCombat: 2,
        justCompletedCombat: false,
        justCompletedDifficultChallenge: false,
        suggestedNextBeat: 'Connect this turn to the main threat and push toward a climactic confrontation.',
        reason: 'The climax needs pressure.',
      },
    });

    expect(result.narration).toContain('Strum a rallying song works');
    expect(result.narration).toContain('A shadow of worse things falls across A ruined keep');
    expect(result.narration).not.toContain('Connect this turn to the main threat');
    expect(result.narration).not.toContain('push toward a climactic confrontation');
  });

  it('passes 1300 max_completion_tokens on normal turns', async () => {
    mockStream({ choices: [{ message: { parsed: output() }, finish_reason: 'stop' }] });
    await new OpenAINarrationProvider().generateTurn(input);
    const callArgs = mocks.stream.mock.calls[0]?.[0] as { max_completion_tokens?: number } | undefined;
    expect(callArgs?.max_completion_tokens).toBe(1300);
  });

  it('passes 1500 max_completion_tokens on high-stakes combat turns', async () => {
    mockStream({ choices: [{ message: { parsed: output() }, finish_reason: 'stop' }] });
    await new OpenAINarrationProvider().generateTurn({
      ...input,
      encounterState: { id: 'enc-1', name: 'Boss Fight', status: 'active', enemies: [], areas: [], round: 1 },
    });
    const callArgs = mocks.stream.mock.calls[0]?.[0] as { max_completion_tokens?: number } | undefined;
    expect(callArgs?.max_completion_tokens).toBe(1500);
  });

  it('passes configured narration eval parameters to Chat Completions', async () => {
    process.env.OPENAI_MODEL_NARRATION = 'gpt-5-mini';
    process.env.OPENAI_REASONING_EFFORT_NARRATION = 'low';
    process.env.OPENAI_TEXT_VERBOSITY_NARRATION = 'low';
    process.env.OPENAI_SERVICE_TIER_NARRATION = 'priority';

    mockStream({ choices: [{ message: { parsed: output() }, finish_reason: 'stop' }] });
    await new OpenAINarrationProvider().generateTurn(input);

    const callArgs = mocks.stream.mock.calls[0]?.[0] as {
      model?: string;
      reasoning_effort?: string;
      verbosity?: string;
      service_tier?: string;
    } | undefined;
    expect(callArgs).toMatchObject({
      model: 'gpt-5-mini',
      reasoning_effort: 'low',
      verbosity: 'low',
      service_tier: 'priority',
    });
  });

  it('logs stream timings and reasoning token usage when available', async () => {
    mockStreamWithContent({
      choices: [{ message: { parsed: output() }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 120,
        prompt_tokens_details: { cached_tokens: 512 },
        completion_tokens_details: { reasoning_tokens: 18 },
      },
      service_tier: 'priority',
    }, [
      '{"rollNarration":"Pip rolls well","narration":"Pip finds',
      '{"rollNarration":"Pip rolls well","narration":"Pip finds the stairs"}',
    ]);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await new OpenAINarrationProvider().generateTurn(input, {
        onChunk: vi.fn(),
        onRollNarrationDone: vi.fn(),
        onStreamingDone: vi.fn(),
        onAbort: vi.fn(),
      });

      expect(log).toHaveBeenCalledWith(expect.stringContaining('[Narration] attempt-1 done'));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('firstRollChunkMs='));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('firstNarrationChunkMs='));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('streamingDoneMs='));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('cachedTokens=512'));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('reasoningTokens=18'));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('responseServiceTier=priority'));
    } finally {
      log.mockRestore();
    }
  });

  it('throws on content_filter finish reason', async () => {
    mockStream({ choices: [{ message: { parsed: null, refusal: null }, finish_reason: 'content_filter' }] });
    await expect(new OpenAINarrationProvider().generateTurn(input)).rejects.toThrow('content_filter');
  });

  it('throws with length truncation message when finish_reason is length', async () => {
    mockStream({ choices: [{ message: { parsed: null, refusal: null }, finish_reason: 'length' }] });
    await expect(new OpenAINarrationProvider().generateTurn(input)).rejects.toThrow('max_completion_tokens');
  });

  it('allows a resolved enemy name when it is also the active encounter enemy alias', () => {
    const parsed = parseNarrationOutput({
      ...input,
      resolvedEncounterEnemyNames: ['Ambusher'],
      encounterState: {
        id: 'enc-active',
        name: 'Shadow Ambusher Skirmish',
        status: 'active',
        enemies: [{
          id: 'enemy-active',
          name: 'Shadow Ambusher',
          aliases: ['shadow', 'ambusher'],
          role: 'standard',
          hp: 1,
          maxHp: 6,
          status: 'active',
        }],
        areas: [],
        round: 4,
      },
    }, output({
      narration: 'Sprocket steadies the party while the shadow ambusher circles the glowing fissure, still dangerous but contained.',
      choices: [
        { label: 'Ward the fissure', difficulty: 'normal', stat: 'magic', difficultyValue: 12 },
        { label: 'Press the ambusher back', difficulty: 'normal', stat: 'might', difficultyValue: 11 },
        { label: 'Find safer footing', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
      ],
    }));

    expect(parsed.success).toBe(true);
  });
});
