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
  delete process.env.OPENAI_REASONING_EFFORT_ASYNC;
  delete process.env.OPENAI_TEXT_VERBOSITY_NARRATION;
  delete process.env.OPENAI_SERVICE_TIER_NARRATION;
  delete process.env.OPENAI_SERVICE_TIER_PREVIEW;
  delete process.env.OPENAI_SERVICE_TIER_ASYNC;
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

    expect(getModelForTier('narration')).toBe('gpt-6-luna');
    expect(getModelForTier('preview')).toBe('gpt-5.6-luna');
    expect(getModelForTier('async')).toBe('gpt-6-luna');
  });

  it('pairs the built-in preview model with reasoning none so they roll back together', async () => {
    const { getModelForTier, getTierRequestSettings, PREVIEW_DEFAULTS } = await import('./openAiClient.js');

    expect(PREVIEW_DEFAULTS).toEqual({ model: 'gpt-5.6-luna', reasoningEffort: 'none' });
    expect(getModelForTier('preview')).toBe(PREVIEW_DEFAULTS.model);
    expect(getTierRequestSettings('preview')).toEqual({ reasoning_effort: PREVIEW_DEFAULTS.reasoningEffort });
  });

  it('never defaults any tier to a retired gpt-4 series model', async () => {
    const { getModelForTier } = await import('./openAiClient.js');

    for (const tier of ['narration', 'preview', 'async'] as const) {
      expect(getModelForTier(tier)).not.toMatch(/^gpt-4/);
    }
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

  it('pairs the built-in narration and async models with their reasoning and service tier defaults', async () => {
    const { getModelForTier, getTierRequestSettings, NARRATION_DEFAULTS, ASYNC_DEFAULTS } = await import('./openAiClient.js');

    expect(NARRATION_DEFAULTS).toEqual({ model: 'gpt-6-luna', reasoningEffort: 'none', serviceTier: 'priority' });
    expect(ASYNC_DEFAULTS).toEqual({ model: 'gpt-6-luna', reasoningEffort: 'none' });
    expect(getModelForTier('narration')).toBe(NARRATION_DEFAULTS.model);
    expect(getModelForTier('async')).toBe(ASYNC_DEFAULTS.model);
    expect(getTierRequestSettings('narration')).toEqual({ reasoning_effort: 'none', service_tier: 'priority' });
    expect(getTierRequestSettings('async')).toEqual({ reasoning_effort: 'none' });
  });

  it.each([
    ['narration', 'OPENAI_REASONING_EFFORT_NARRATION'],
    ['async', 'OPENAI_REASONING_EFFORT_ASYNC'],
  ] as const)('sends a configured %s reasoning_effort and drops it for omit', async (tier, envName) => {
    const { getTierRequestSettings } = await import('./openAiClient.js');

    process.env[envName] = 'low';
    expect(getTierRequestSettings(tier).reasoning_effort).toBe('low');
    expect(getTierRequestSettings('preview')).toEqual({ reasoning_effort: 'none' });

    process.env[envName] = 'omit';
    expect(getTierRequestSettings(tier)).not.toHaveProperty('reasoning_effort');
  });

  it.each(['REASONING_EFFORT', 'SERVICE_TIER'])('refuses an invalid OPENAI_%s_<tier> at the startup check', async (setting) => {
    const { assertTierRequestSettings } = await import('./openAiClient.js');

    for (const suffix of ['NARRATION', 'PREVIEW', 'ASYNC']) {
      process.env[`OPENAI_${setting}_${suffix}`] = 'turbo';
      expect(() => assertTierRequestSettings()).toThrow(new RegExp(`Invalid OPENAI_${setting}_${suffix}="turbo"`));
      delete process.env[`OPENAI_${setting}_${suffix}`];
    }
  });

  it('sends a configured service tier only on its own tier and drops it for omit', async () => {
    process.env.OPENAI_SERVICE_TIER_ASYNC = 'flex';

    const { getTierRequestSettings } = await import('./openAiClient.js');

    expect(getTierRequestSettings('async')).toEqual({ reasoning_effort: 'none', service_tier: 'flex' });
    expect(getTierRequestSettings('preview')).toEqual({ reasoning_effort: 'none' });
    expect(getTierRequestSettings('narration').service_tier).toBe('priority');

    process.env.OPENAI_SERVICE_TIER_NARRATION = 'omit';
    expect(getTierRequestSettings('narration')).toEqual({ reasoning_effort: 'none' });
  });

  it('returns undefined for an unset narration text verbosity', async () => {
    const { getNarrationTextVerbosity } = await import('./openAiClient.js');

    expect(getNarrationTextVerbosity()).toBeUndefined();
  });

  it('returns a configured narration text verbosity', async () => {
    process.env.OPENAI_TEXT_VERBOSITY_NARRATION = 'low';

    const { getNarrationTextVerbosity } = await import('./openAiClient.js');

    expect(getNarrationTextVerbosity()).toBe('low');
  });

  it('ignores an invalid narration text verbosity', async () => {
    process.env.OPENAI_TEXT_VERBOSITY_NARRATION = 'tiny';

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { getNarrationTextVerbosity } = await import('./openAiClient.js');

    try {
      expect(getNarrationTextVerbosity()).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
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
