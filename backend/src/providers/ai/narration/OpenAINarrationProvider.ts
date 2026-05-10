import OpenAI from 'openai';
import type { NarrationInput, NarrationOutput, NarrationProvider } from './NarrationProvider.js';
import { buildNarrationFallback } from './narrationFallback.js';
import { NARRATION_SYSTEM_PROMPT, buildNarrationRetryInstructions, buildNarrationUserContent } from './narrationPrompt.js';
import { parseNarrationOutput } from './narrationOutputGuards.js';

let _openai: OpenAI | null = null;
const openai = () => (_openai ??= new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_BASE_URL && { baseURL: process.env.OPENAI_BASE_URL }),
}));

export class OpenAINarrationProvider implements NarrationProvider {
  async generateTurn(input: NarrationInput): Promise<NarrationOutput> {
    const content = await this.callModel(input);
    const parsed = parseNarrationOutput(input, JSON.parse(content));
    if (parsed.success) {
      return parsed.data;
    }

    console.warn('[OpenAINarration] First attempt failed validation, retrying...', parsed.error);
    const retryContent = await this.callModel(input, parsed.error);
    const retryParsed = parseNarrationOutput(input, JSON.parse(retryContent));
    if (retryParsed.success) {
      return {
        ...retryParsed.data,
        narrationRetried: true,
        narrationValidationError: parsed.error,
      };
    }

    console.error('[OpenAINarration] Retry also failed, using fallback.', retryParsed.error, 'Raw:', retryContent);
    return {
      ...buildNarrationFallback(input),
      narrationRetried: true,
      narrationFailed: true,
      narrationValidationError: parsed.error,
      narrationRetryValidationError: retryParsed.error,
    };
  }

  private async callModel(input: NarrationInput, validationError?: string): Promise<string> {
    const extra = validationError
      ? buildNarrationRetryInstructions(validationError)
      : '';
    const response = await openai().chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      messages: [
        { role: 'system', content: NARRATION_SYSTEM_PROMPT + extra },
        { role: 'user', content: buildNarrationUserContent(input) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('OpenAI returned empty content'); 
    }
    return content;
  }
}
