import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

// Captures the outgoing request for every distinct preview-tier request shape
// and asserts the preview request settings reach the wire (model refresh
// deliverable 1).
const mocks = vi.hoisted(() => {
  const create = vi.fn();
  const stream = vi.fn();
  const OpenAI = vi.fn(function OpenAIMock() {
    return { chat: { completions: { create, stream } } };
  });
  return { OpenAI, create, stream };
});

vi.mock('openai', () => ({ default: mocks.OpenAI }));

const session = {
  id: 'session-1',
  activeCharacterId: 'char-1',
  party: [{
    id: 'char-1',
    name: 'Pip',
    class: 'Rogue',
    species: 'Halfling',
    quirk: 'Hums while sneaking',
    hp: 8,
    max_hp: 10,
    status: 'active',
    stats: { might: 1, magic: 2, mischief: 4 },
    inventory: [],
  }],
  recentHistory: ['Pip crept into the vault.'],
  storySummary: 'The party is robbing a rune vault.',
};

vi.mock('../../services/stateService.js', () => ({
  StateService: {
    getSession: vi.fn(async () => session),
    getTurnHistory: vi.fn(async () => []),
  },
}));

const completion = (content: string, finishReason = 'stop') => ({
  choices: [{ finish_reason: finishReason, message: { content, refusal: null } }],
});

type PreviewCaller = {
  name: string;
  run: () => Promise<unknown>;
  content: string;
};

const callers: PreviewCaller[] = [
  {
    name: 'session name',
    content: 'Rune Vault',
    run: async () => (await import('../../services/sessionNameService.js')).generateSessionDisplayName('A rune vault'),
  },
  {
    name: 'stat suggestion (10-token cap)',
    content: 'mischief',
    run: async () => (await import('../../services/statSuggestionService.js')).suggestStatForSessionAction('session-1', { action: 'Pick the lock' }),
  },
  {
    name: 'free action preview',
    content: '{"stat":"mischief","narration":"Pip picks the lock."}',
    run: async () => (await import('../../services/statSuggestionService.js')).previewFreeAction('session-1', { action: 'Pick the lock' }),
  },
  {
    name: 'image brief',
    content: 'A halfling picks a glowing rune lock.',
    run: async () => (await import('./images/imageBriefProvider.js')).generateImageBrief('Pip picks the lock.', 'Rune vault', 'Pip', 'medium'),
  },
  {
    name: 'DM prep compilation',
    content: 'A rune vault hides a stolen crown. The vault warden hunts thieves.',
    run: async () => (await import('../../services/dmPrepCompilationService.js')).compileDmPrepPremise('A long campaign brief about a rune vault, a stolen crown, and a warden who hunts thieves.'),
  },
  {
    name: 'character stat suggestion route',
    content: '{"might":1,"magic":1,"mischief":5}',
    run: async () => {
      const { createStatSuggestionRouter } = await import('../../routes/statSuggestionRoutes.js');
      const router = createStatSuggestionRouter() as unknown as {
        stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: Request, res: Response, next: () => void) => unknown }> } }>;
      };
      const layer = router.stack.find(l => l.route?.path === '/character/suggest-stats');
      const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
      const req = { body: { name: 'Pip', class: 'Rogue', species: 'Halfling', quirk: 'Hums' } } as Request;
      await layer?.route?.stack[0].handle(req, res, () => undefined);
      return (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    },
  },
];

function lastRequest(): Record<string, unknown> {
  expect(mocks.create).toHaveBeenCalledTimes(1);
  return mocks.create.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = 'test-key';
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL_PREVIEW;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_REASONING_EFFORT_PREVIEW;
});

describe.each(callers)('preview request settings: $name', (caller) => {
  it('sends max_completion_tokens, no max_tokens, no temperature, and no reasoning field when unset', async () => {
    mocks.create.mockResolvedValueOnce(completion(caller.content));

    await caller.run();

    const request = lastRequest();
    expect(request.model).toBe('gpt-4.1-nano');
    expect(request.max_completion_tokens).toEqual(expect.any(Number));
    expect(request).not.toHaveProperty('max_tokens');
    expect(request).not.toHaveProperty('temperature');
    expect(request).not.toHaveProperty('reasoning_effort');
  });

  it('sends reasoning_effort none when explicitly configured, for a custom model and base URL', async () => {
    process.env.OPENAI_REASONING_EFFORT_PREVIEW = 'none';
    process.env.OPENAI_MODEL_PREVIEW = 'custom-preview-model';
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9999/v1';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mocks.create.mockResolvedValueOnce(completion(caller.content));

    await caller.run();

    const request = lastRequest();
    expect(request.model).toBe('custom-preview-model');
    expect(request.reasoning_effort).toBe('none');
    expect(request).not.toHaveProperty('temperature');
    expect(mocks.OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'http://127.0.0.1:9999/v1' }));
  });

  it('omits the reasoning field for the explicit omit escape hatch', async () => {
    process.env.OPENAI_REASONING_EFFORT_PREVIEW = 'omit';
    mocks.create.mockResolvedValueOnce(completion(caller.content));

    await caller.run();

    expect(lastRequest()).not.toHaveProperty('reasoning_effort');
  });

  it('warns in production when a reply is empty and truncated by the token cap', async () => {
    process.env.OPENAI_REASONING_EFFORT_PREVIEW = 'none';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.create.mockResolvedValueOnce(completion('', 'length'));

    await caller.run();

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/truncated: empty content with finish_reason=length model=gpt-4\.1-nano/));
    warn.mockRestore();
  });
});

describe('preview request token caps', () => {
  it.each([
    ['stat suggestion', 1, 10],
    ['session name', 0, 20],
  ])('keeps the %s cap and does not warn on a non-empty reply', async (_name, index, cap) => {
    process.env.OPENAI_REASONING_EFFORT_PREVIEW = 'none';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.create.mockResolvedValueOnce(completion(callers[index].content));

    await callers[index].run();

    expect(lastRequest()).toMatchObject({ max_completion_tokens: cap, reasoning_effort: 'none' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('invalid preview reasoning setting', () => {
  it('fails clearly instead of falling back to provider-default reasoning', async () => {
    process.env.OPENAI_REASONING_EFFORT_PREVIEW = 'turbo';
    const { getTierRequestSettings } = await import('./openAiClient.js');

    expect(() => getTierRequestSettings('preview')).toThrow(/Invalid OPENAI_REASONING_EFFORT_PREVIEW="turbo"/);
  });

  it('never applies preview settings to other tiers', async () => {
    process.env.OPENAI_REASONING_EFFORT_PREVIEW = 'none';
    const { getTierRequestSettings } = await import('./openAiClient.js');

    expect(getTierRequestSettings('preview')).toEqual({ reasoning_effort: 'none' });
    expect(getTierRequestSettings('narration')).toEqual({});
    expect(getTierRequestSettings('async')).toEqual({});
  });
});
