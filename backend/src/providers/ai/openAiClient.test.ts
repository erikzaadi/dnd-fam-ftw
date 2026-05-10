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
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_IMAGE_MODEL;
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

  it('uses separate chat and image model env vars', async () => {
    process.env.OPENAI_MODEL = 'chat-model';
    process.env.OPENAI_IMAGE_MODEL = 'image-model';

    const { getOpenAIImageModel, getOpenAIModel } = await import('./openAiClient.js');

    expect(getOpenAIModel()).toBe('chat-model');
    expect(getOpenAIImageModel()).toBe('image-model');
  });
});
