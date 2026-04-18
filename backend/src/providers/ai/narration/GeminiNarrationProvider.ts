import axios, { AxiosError } from 'axios';
import type { NarrationInput, NarrationOutput, NarrationProvider } from './NarrationProvider.js';
import { narrationOutputSchema, NARRATION_FALLBACK } from './narrationSchemas.js';
import { NARRATION_SYSTEM_PROMPT, buildNarrationUserContent } from './narrationPrompt.js';

export class GeminiNarrationProvider implements NarrationProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
    this.model = process.env.OPENAI_MODEL ?? 'gemini-2.0-flash-lite';
  }

  async generateTurn(input: NarrationInput): Promise<NarrationOutput> {
    const content = await this.callModel(input);
    const parsed = narrationOutputSchema.safeParse(JSON.parse(content));
    if (parsed.success) {
      return parsed.data;
    }

    console.warn('[GeminiNarration] First attempt failed validation, retrying...', parsed.error.message);
    const retryContent = await this.callModel(input, true);
    const retryParsed = narrationOutputSchema.safeParse(JSON.parse(retryContent));
    if (retryParsed.success) {
      return retryParsed.data;
    }

    console.error('[GeminiNarration] Retry also failed, using fallback. Raw:', retryContent);
    return NARRATION_FALLBACK;
  }

  private async callModel(input: NarrationInput, strict = false): Promise<string> {
    const extra = strict ? '\nCRITICAL: Return ONLY valid JSON matching the exact schema.' : '';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    console.log(`[GeminiNarration] Sending request model=${this.model} strict=${strict}`);
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
