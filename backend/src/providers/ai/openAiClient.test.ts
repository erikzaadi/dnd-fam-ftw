import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const OpenAI = vi.fn(function OpenAIMock() {
    return {};
  });
  return { OpenAI };
});

vi.mock('openai', () => ({
  default: mocks.OpenAI,
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MAX_RETRIES;
  delete process.env.OPENAI_IMAGE_MODEL;
  delete process.env.OPENAI_MODEL_NARRATION;
  delete process.env.OPENAI_MODEL_PREVIEW;
  delete process.env.OPENAI_MODEL_ASYNC;
  delete process.env.OPENAI_REASONING_EFFORT_PREVIEW;
  delete process.env.OPENAI_REASONING_EFFORT_NARRATION;
  delete process.env.OPENAI_TEXT_VERBOSITY_NARRATION;
  delete process.env.OPENAI_SERVICE_TIER_NARRATION;
});

describe('openAiClient', () => {
  it('creates an OpenAI-compatible client with baseURL when configured', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9999/v1';

    const { createOpenAIClient } = await import('./openAiClient.js');
    createOpenAIClient();

    expect(mocks.OpenAI).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseURL: 'http://127.0.0.1:9999/v1',
    });
  });

  it('getModelForTier returns hardcoded defaults when env vars are unset', async () => {
    const { getModelForTier } = await import('./openAiClient.js');

    expect(getModelForTier('narration')).toBe('gpt-4.1-mini');
    expect(getModelForTier('preview')).toBe('gpt-5.6-luna');
    expect(getModelForTier('async')).toBe('gpt-4.1');
  });

  it('pairs the built-in preview model with reasoning none so they roll back together', async () => {
    const { getModelForTier, getTierRequestSettings, PREVIEW_DEFAULTS } = await import('./openAiClient.js');

    expect(PREVIEW_DEFAULTS).toEqual({ model: 'gpt-5.6-luna', reasoningEffort: 'none' });
    expect(getModelForTier('preview')).toBe(PREVIEW_DEFAULTS.model);
    expect(getTierRequestSettings('preview')).toEqual({ reasoning_effort: PREVIEW_DEFAULTS.reasoningEffort });
  });

  it('never defaults the preview tier to the retired gpt-4.1-nano', async () => {
    const { getModelForTier } = await import('./openAiClient.js');

    expect(getModelForTier('preview')).not.toMatch(/gpt-4\.1-nano/);
  });

  it('getModelForTier respects per-tier env var overrides', async () => {
    process.env.OPENAI_MODEL_NARRATION = 'custom-narration';
    process.env.OPENAI_MODEL_PREVIEW = 'custom-preview';
    process.env.OPENAI_MODEL_ASYNC = 'custom-async';

    const { getModelForTier } = await import('./openAiClient.js');

    expect(getModelForTier('narration')).toBe('custom-narration');
    expect(getModelForTier('preview')).toBe('custom-preview');
    expect(getModelForTier('async')).toBe('custom-async');
  });

  it('getOpenAIImageModel respects env var override', async () => {
    process.env.OPENAI_IMAGE_MODEL = 'custom-image-model';

    const { getOpenAIImageModel } = await import('./openAiClient.js');

    expect(getOpenAIImageModel()).toBe('custom-image-model');
  });

  it('returns undefined for unset narration eval parameters', async () => {
    const {
      getNarrationReasoningEffort,
      getNarrationTextVerbosity,
      getNarrationServiceTier,
    } = await import('./openAiClient.js');

    expect(getNarrationReasoningEffort()).toBeUndefined();
    expect(getNarrationTextVerbosity()).toBeUndefined();
    expect(getNarrationServiceTier()).toBeUndefined();
  });

  it('returns configured narration eval parameters', async () => {
    process.env.OPENAI_REASONING_EFFORT_NARRATION = 'low';
    process.env.OPENAI_TEXT_VERBOSITY_NARRATION = 'low';
    process.env.OPENAI_SERVICE_TIER_NARRATION = 'priority';

    const {
      getNarrationReasoningEffort,
      getNarrationTextVerbosity,
      getNarrationServiceTier,
    } = await import('./openAiClient.js');

    expect(getNarrationReasoningEffort()).toBe('low');
    expect(getNarrationTextVerbosity()).toBe('low');
    expect(getNarrationServiceTier()).toBe('priority');
  });

  it('ignores invalid narration eval parameters', async () => {
    process.env.OPENAI_REASONING_EFFORT_NARRATION = 'turbo';
    process.env.OPENAI_TEXT_VERBOSITY_NARRATION = 'tiny';
    process.env.OPENAI_SERVICE_TIER_NARRATION = 'vip';

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const {
      getNarrationReasoningEffort,
      getNarrationTextVerbosity,
      getNarrationServiceTier,
    } = await import('./openAiClient.js');

    try {
      expect(getNarrationReasoningEffort()).toBeUndefined();
      expect(getNarrationTextVerbosity()).toBeUndefined();
      expect(getNarrationServiceTier()).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(3);
    } finally {
      warn.mockRestore();
    }
  });

  it('omits maxRetries from the SDK constructor when OPENAI_MAX_RETRIES is unset', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const { createOpenAIClient } = await import('./openAiClient.js');
    createOpenAIClient();

    expect(mocks.OpenAI).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  it('passes OPENAI_MAX_RETRIES=0 to the SDK constructor', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MAX_RETRIES = '0';

    const { createOpenAIClient, getOpenAIMaxRetries } = await import('./openAiClient.js');
    createOpenAIClient();

    expect(getOpenAIMaxRetries()).toBe(0);
    expect(mocks.OpenAI).toHaveBeenCalledWith({ apiKey: 'test-key', maxRetries: 0 });
  });

  it('passes a positive OPENAI_MAX_RETRIES to the SDK constructor', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MAX_RETRIES = '3';

    const { createOpenAIClient } = await import('./openAiClient.js');
    createOpenAIClient();

    expect(mocks.OpenAI).toHaveBeenCalledWith({ apiKey: 'test-key', maxRetries: 3 });
  });

  it.each(['-1', '1.5', 'two', ' 2'])('rejects invalid OPENAI_MAX_RETRIES=%j', async (value) => {
    process.env.OPENAI_MAX_RETRIES = value;

    const { createOpenAIClient } = await import('./openAiClient.js');

    expect(() => createOpenAIClient()).toThrow(/OPENAI_MAX_RETRIES/);
    expect(mocks.OpenAI).not.toHaveBeenCalled();
  });

  it('reuses the singleton client without re-reading OPENAI_MAX_RETRIES', async () => {
    process.env.OPENAI_MAX_RETRIES = '0';

    const { createOpenAIClient } = await import('./openAiClient.js');
    const first = createOpenAIClient();
    process.env.OPENAI_MAX_RETRIES = '5';
    const second = createOpenAIClient();

    expect(second).toBe(first);
    expect(mocks.OpenAI).toHaveBeenCalledTimes(1);
  });
});
