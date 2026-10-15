import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../../types.js';

// Captures the outgoing request for every non-streamed narration and async
// tier caller and asserts the tier settings reach the wire (GPT-4 series
// retirement). Streamed orchestrator agents share
// callStructuredAgent, which already spreads its requestSettings.
const mocks = vi.hoisted(() => {
  const create = vi.fn();
  const OpenAI = vi.fn(function OpenAIMock() {
    return { chat: { completions: { create } } };
  });
  return { OpenAI, create };
});

vi.mock('openai', () => ({ default: mocks.OpenAI }));

const completion = (content: string, finishReason = 'stop') => ({
  choices: [{ finish_reason: finishReason, message: { content, refusal: null } }],
});

const session = {
  id: 'session-1',
  displayName: 'Rune Vault',
  scene: 'The vault door',
  party: [],
} as unknown as SessionState;

type TierCaller = {
  name: string;
  tier: 'narration' | 'async';
  run: () => Promise<unknown>;
};

const callers: TierCaller[] = [
  {
    name: 'adventure summary (TLDR)',
    tier: 'narration',
    run: async () => (await import('../../services/playerSummaryService.js')).summarizeAdventure(session, []),
  },
  {
    name: 'hero history',
    tier: 'narration',
    run: async () => (await import('../../services/playerSummaryService.js')).summarizeHeroHistory([{ narration: 'Pip picked the lock.' }], 'Rune Vault'),
  },
  {
    name: 'epilogue',
    tier: 'narration',
    run: async () => (await import('../../services/adventureConclusionService.js')).generateEpilogueText(session, [], 'success'),
  },
  {
    name: 'story summary (DM prep image brief)',
    tier: 'async',
    run: async () => (await import('../../services/storySummaryService.js')).StorySummaryService.generateDmPrepImageBrief('A rune vault guarded by a warden.'),
  },
];

const envName = (tier: TierCaller['tier']) => (tier === 'narration' ? 'OPENAI_REASONING_EFFORT_NARRATION' : 'OPENAI_REASONING_EFFORT_ASYNC');

function lastRequest(): Record<string, unknown> {
  expect(mocks.create).toHaveBeenCalledTimes(1);
  return mocks.create.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = 'test-key';
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_REASONING_EFFORT_NARRATION;
  delete process.env.OPENAI_REASONING_EFFORT_ASYNC;
  delete process.env.OPENAI_SERVICE_TIER_NARRATION;
  delete process.env.OPENAI_SERVICE_TIER_ASYNC;
});

describe.each(callers)('tier request settings: $name', (caller) => {
  it('sends the built-in model with reasoning none, max_completion_tokens, and no max_tokens or temperature', async () => {
    mocks.create.mockResolvedValueOnce(completion('A short reply.'));

    await caller.run();

    const request = lastRequest();
    expect(request.model).toBe('gpt-6-luna');
    expect(request.reasoning_effort).toBe('none');
    expect(request.max_completion_tokens).toEqual(expect.any(Number));
    expect(request).not.toHaveProperty('max_tokens');
    expect(request).not.toHaveProperty('temperature');
    // Fast mode is a narration-tier default only; background work runs at Standard.
    if (caller.tier === 'narration') {
      expect(request.service_tier).toBe('priority');
    } else {
      expect(request).not.toHaveProperty('service_tier');
    }
  });

  it('sends the configured reasoning effort for its own tier', async () => {
    process.env[envName(caller.tier)] = 'low';
    mocks.create.mockResolvedValueOnce(completion('A short reply.'));

    await caller.run();

    expect(lastRequest().reasoning_effort).toBe('low');
  });

  it('sends the configured service tier for its own tier', async () => {
    process.env[caller.tier === 'narration' ? 'OPENAI_SERVICE_TIER_NARRATION' : 'OPENAI_SERVICE_TIER_ASYNC'] = 'flex';
    mocks.create.mockResolvedValueOnce(completion('A short reply.'));

    await caller.run();

    expect(lastRequest().service_tier).toBe('flex');
  });

  it('warns when a reply is empty and truncated by the token cap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.create.mockResolvedValueOnce(completion('', 'length'));

    await caller.run();

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/truncated: empty content with finish_reason=length/));
  });
});
