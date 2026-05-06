import axios, { AxiosError } from 'axios';
import type { NarrationInput, NarrationOutput, NarrationProvider } from './NarrationProvider.js';
import { NARRATION_FALLBACK } from './narrationSchemas.js';
import { NARRATION_SYSTEM_PROMPT, buildNarrationRetryInstructions, buildNarrationUserContent } from './narrationPrompt.js';
import { parseNarrationOutput } from './narrationOutputGuards.js';

export class GeminiNarrationProvider implements NarrationProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
    this.model = process.env.OPENAI_MODEL ?? 'gemini-2.0-flash-lite';
  }

  async generateTurn(input: NarrationInput): Promise<NarrationOutput> {
    const content = await this.callModel(input);
    const parsed = parseNarrationOutput(input, JSON.parse(content));
    if (parsed.success) {
      return parsed.data;
    }

    console.warn('[GeminiNarration] First attempt failed validation, retrying...', parsed.error);
    const retryContent = await this.callModel(input, parsed.error);
    const retryParsed = parseNarrationOutput(input, JSON.parse(retryContent));
    if (retryParsed.success) {
      return {
        ...retryParsed.data,
        narrationRetried: true,
        narrationValidationError: parsed.error,
      };
    }

    console.error('[GeminiNarration] Retry also failed, using fallback.', retryParsed.error, 'Raw:', retryContent);
    return {
      ...NARRATION_FALLBACK,
      narrationRetried: true,
      narrationFailed: true,
      narrationValidationError: parsed.error,
      narrationRetryValidationError: retryParsed.error,
    };
  }

  private async callModel(input: NarrationInput, validationError?: string): Promise<string> {
    const extra = validationError
      ? buildNarrationRetryInstructions(validationError, 'No explanation.')
      : '';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    console.log(`[GeminiNarration] Sending request model=${this.model} retry=${validationError != null}`);
    const start = Date.now();

    try {
      const response = await axios.post(url, {
        system_instruction: { parts: [{ text: NARRATION_SYSTEM_PROMPT + extra }] },
        contents: [{ parts: [{ text: buildNarrationUserContent(input) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.7,
        },
      });

      console.log(`[GeminiNarration] Response received in ${Date.now() - start}ms`);

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini narration returned no text');
      }
      return text;
    } catch (err) {
      if (err instanceof AxiosError) {
        console.error(`[GeminiNarration] HTTP ${err.response?.status} after ${Date.now() - start}ms:`, JSON.stringify(err.response?.data));
        const httpErr = Object.assign(new Error(err.message), { status: err.response?.status });
        throw httpErr;
      }
      throw err;
    }
  }
}
