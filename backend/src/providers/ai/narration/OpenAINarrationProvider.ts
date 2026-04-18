import OpenAI from 'openai';
import type { NarrationInput, NarrationOutput, NarrationProvider } from './NarrationProvider.js';
import { narrationOutputSchema, NARRATION_FALLBACK } from './narrationSchemas.js';
import { NARRATION_SYSTEM_PROMPT, buildNarrationUserContent } from './narrationPrompt.js';

let _openai: OpenAI | null = null;
const openai = () => (_openai ??= new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_BASE_URL && { baseURL: process.env.OPENAI_BASE_URL }),
}));

export class OpenAINarrationProvider implements NarrationProvider {
  async generateTurn(input: NarrationInput): Promise<NarrationOutput> {
    const content = await this.callModel(input);
    const parsed = narrationOutputSchema.safeParse(JSON.parse(content));
    if (parsed.success) {
      return parsed.data;
    }

    console.warn('[OpenAINarration] First attempt failed validation, retrying...', parsed.error.message);
    const retryContent = await this.callModel(input, true);
    const retryParsed = narrationOutputSchema.safeParse(JSON.parse(retryContent));
    if (retryParsed.success) {
      return retryParsed.data;
    }

    console.error('[OpenAINarration] Retry also failed, using fallback. Raw:', retryContent);
    return NARRATION_FALLBACK;
  }

  private async callModel(input: NarrationInput, strict = false): Promise<string> {
    const extra = strict ? '\nCRITICAL: Return ONLY valid JSON matching the exact schema. No markdown, no explanation.' : '';
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
