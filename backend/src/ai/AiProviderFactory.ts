import OpenAI from 'openai';
import type { NarrationProvider } from './narration/NarrationProvider.js';
import type { ImageProvider } from './images/ImageProvider.js';
import { OpenAINarrationProvider } from './narration/OpenAINarrationProvider.js';
import { LocalAINarrationProvider } from './narration/LocalAINarrationProvider.js';
import { GeminiNarrationProvider } from './narration/GeminiNarrationProvider.js';
import { OpenAIImageProvider } from './images/OpenAIImageProvider.js';
import { LocalAIImageProvider } from './images/LocalAIImageProvider.js';
import { GeminiImageProvider } from './images/GeminiImageProvider.js';

export function createNarrationProvider(useLocalAI?: boolean): NarrationProvider {
  const envProvider = process.env.AI_NARRATION_PROVIDER ?? 'openai';

  if (useLocalAI ?? envProvider === 'localai') {
    console.log('[AI] Narration provider: LocalAI');
    return new LocalAINarrationProvider();
  }

  if (envProvider === 'gemini') {
    console.log('[AI] Narration provider: Gemini');
    return new GeminiNarrationProvider();
  }

  console.log('[AI] Narration provider: OpenAI');
  return new OpenAINarrationProvider();
}

export function createChatClient(useLocalAI?: boolean): { client: OpenAI; model: string } {
  const envProvider = process.env.AI_NARRATION_PROVIDER ?? 'openai';
  const isLocal = useLocalAI ?? envProvider === 'localai';

  if (isLocal) {
    const baseURL = process.env.LOCALAI_BASE_URL ?? 'http://127.0.0.1:8080';
    console.log(`[AI] Chat client: LocalAI baseURL=${baseURL}`);
    return {
      client: new OpenAI({ apiKey: 'localai', baseURL: `${baseURL}/v1` }),
      model: process.env.LOCALAI_NARRATION_MODEL ?? 'qwen_qwen3.5-4b',
    };
  }

  if (process.env.OPENAI_BASE_URL) {
    console.log(`[AI] Chat client: OpenAI baseURL=${process.env.OPENAI_BASE_URL}`);
  }
  return {
    client: new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      ...(process.env.OPENAI_BASE_URL && { baseURL: process.env.OPENAI_BASE_URL }),
    }),
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  };
}

export function createImageProvider(useLocalAI?: boolean): ImageProvider {
  const envProvider = process.env.AI_IMAGE_PROVIDER ?? 'openai';

  if (useLocalAI ?? envProvider === 'localai') {
    console.log('[AI] Image provider: LocalAI');
    return new LocalAIImageProvider();
  }

  if (envProvider === 'gemini') {
    console.log('[AI] Image provider: Gemini');
    return new GeminiImageProvider();
  }

  console.log('[AI] Image provider: OpenAI');
  return new OpenAIImageProvider();
}
