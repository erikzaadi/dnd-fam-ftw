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
  delete process.env.OPENAI_IMAGE_MODEL;
  delete process.env.OPENAI_MODEL_NARRATION;
  delete process.env.OPENAI_MODEL_PREVIEW;
  delete process.env.OPENAI_MODEL_ASYNC;
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
    expect(getModelForTier('preview')).toBe('gpt-4.1-nano');
    expect(getModelForTier('async')).toBe('gpt-4.1');
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
});
