import OpenAI from 'openai';

let _client: OpenAI | null = null;
let loggedBaseUrl = false;

export type OpenAIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type OpenAITextVerbosity = 'low' | 'medium' | 'high';
export type OpenAIServiceTier = 'auto' | 'default' | 'flex' | 'scale' | 'priority';

function optionalEnum<T extends string>(envName: string, allowed: readonly T[]): T | undefined {
  const value = process.env[envName];
  if (!value) {
    return undefined;
  }
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  console.warn(`[AI] Ignoring invalid ${envName}="${value}". Allowed: ${allowed.join(', ')}`);
  return undefined;
}

export function createOpenAIClient(): OpenAI {
  if (!_client) {
    if (process.env.OPENAI_BASE_URL && !loggedBaseUrl) {
      console.log(`[AI] OpenAI-compatible baseURL=${process.env.OPENAI_BASE_URL}`);
      loggedBaseUrl = true;
    }
    _client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      ...(process.env.OPENAI_BASE_URL && { baseURL: process.env.OPENAI_BASE_URL }),
    });
  }
  return _client;
}

export function getModelForTier(tier: 'narration' | 'preview' | 'async'): string {
  switch (tier) {
  case 'narration':
    return process.env.OPENAI_MODEL_NARRATION ?? 'gpt-4.1-mini';
  case 'preview':
    return process.env.OPENAI_MODEL_PREVIEW ?? 'gpt-4.1-nano';
  case 'async':
    return process.env.OPENAI_MODEL_ASYNC ?? 'gpt-4.1';
  }
}

export function getNarrationReasoningEffort(): OpenAIReasoningEffort | undefined {
  return optionalEnum('OPENAI_REASONING_EFFORT_NARRATION', ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const);
}

export function getNarrationTextVerbosity(): OpenAITextVerbosity | undefined {
  return optionalEnum('OPENAI_TEXT_VERBOSITY_NARRATION', ['low', 'medium', 'high'] as const);
}

export function getNarrationServiceTier(): OpenAIServiceTier | undefined {
  return optionalEnum('OPENAI_SERVICE_TIER_NARRATION', ['auto', 'default', 'flex', 'scale', 'priority'] as const);
}

export function getOpenAIImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2';
}
