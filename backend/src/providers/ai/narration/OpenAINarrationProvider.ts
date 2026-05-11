import { zodResponseFormat } from 'openai/helpers/zod';
import type { NarrationInput, NarrationOutput, NarrationProvider } from './NarrationProvider.js';
import { buildNarrationFallback } from './narrationFallback.js';
import { NARRATION_SYSTEM_PROMPT, buildNarrationUserContent } from './narrationPrompt.js';
import { parseNarrationOutput } from './narrationOutputGuards.js';
import { narrationOutputSchema } from './narrationSchemas.js';
import { createOpenAIClient, getOpenAIModel } from '../openAiClient.js';

export class OpenAINarrationProvider implements NarrationProvider {
  async generateTurn(input: NarrationInput): Promise<NarrationOutput> {
    const raw = await this.callModel(input);
    const parsed = parseNarrationOutput(input, raw);
    if (parsed.success) {
      return parsed.data;
    }

    console.warn('[OpenAINarration] First attempt failed validation, retrying...', parsed.error);
    const retryRaw = await this.callModel(input, parsed.error);
    const retryParsed = parseNarrationOutput(input, retryRaw);
    if (retryParsed.success) {
      return {
        ...retryParsed.data,
        narrationRetried: true,
        narrationValidationError: parsed.error,
      };
    }

    const usableRetry = parseNarrationOutput(input, retryRaw, { enforceGameplayGuards: false });
    if (usableRetry.success) {
      console.warn('[OpenAINarration] Retry failed gameplay validation, using structured retry output.', retryParsed.error);
      return {
        ...usableRetry.data,
        narrationRetried: true,
        narrationValidationError: parsed.error,
        narrationRetryValidationError: retryParsed.error,
      };
    }

    console.error('[OpenAINarration] Retry also failed, using fallback.', retryParsed.error, 'Raw:', JSON.stringify(retryRaw));
    return {
      ...buildNarrationFallback(input),
      narrationRetried: true,
      narrationFailed: true,
      narrationValidationError: parsed.error,
      narrationRetryValidationError: retryParsed.error,
    };
  }

  private async callModel(input: NarrationInput, validationError?: string): Promise<unknown> {
    const response = await createOpenAIClient().chat.completions.parse({
      model: getOpenAIModel(),
      messages: [
        { role: 'system', content: NARRATION_SYSTEM_PROMPT },
        { role: 'user', content: buildNarrationUserContent(input, validationError) },
      ],
      response_format: zodResponseFormat(narrationOutputSchema, 'narration_output'),
      temperature: 0.7,
    });

    const message = response.choices[0].message;
    if (message.refusal) {
      throw new Error(`OpenAI refused: ${message.refusal}`);
    }
    if (!message.parsed) {
      throw new Error('OpenAI response did not include parsed structured output.');
    }
    return message.parsed;
  }
}
