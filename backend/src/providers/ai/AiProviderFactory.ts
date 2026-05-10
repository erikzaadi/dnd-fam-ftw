import type { NarrationProvider } from './narration/NarrationProvider.js';
import type { ImageProvider } from './images/ImageProvider.js';
import { OpenAINarrationProvider } from './narration/OpenAINarrationProvider.js';
import { MockNarrationProvider } from './narration/MockNarrationProvider.js';
import { OpenAIImageProvider } from './images/OpenAIImageProvider.js';
import { createOpenAIClient, getOpenAIModel } from './openAiClient.js';
import type OpenAI from 'openai';

export function createNarrationProvider(): NarrationProvider {
  if (process.env.TEST_AI_MOCK === 'true') {
    console.log('[AI] Narration provider: Test mock');
    return new MockNarrationProvider();
  }
  return new OpenAINarrationProvider();
}

export function createChatClient(): { client: OpenAI; model: string } {
  return {
    client: createOpenAIClient(),
    model: getOpenAIModel(),
  };
}

export function createImageProvider(): ImageProvider {
  return new OpenAIImageProvider();
}
