import OpenAI from 'openai';

let _client: OpenAI | null = null;
let loggedBaseUrl = false;

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

export function getOpenAIModel(): string {
  return process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
}

export function getOpenAIImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2';
}
