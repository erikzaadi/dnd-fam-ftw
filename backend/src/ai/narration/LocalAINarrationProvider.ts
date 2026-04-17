import OpenAI from 'openai';
import type { NarrationInput, NarrationOutput, NarrationProvider } from './NarrationProvider.js';
import { narrationOutputSchema, NARRATION_FALLBACK } from './narrationSchemas.js';
import { NARRATION_SYSTEM_PROMPT, buildNarrationUserContent } from './narrationPrompt.js';

export class LocalAINarrationProvider implements NarrationProvider {
  private client: OpenAI;
  private model: string;

  constructor() {
    const baseURL = process.env.LOCALAI_BASE_URL ?? 'http://127.0.0.1:8080';
    this.model = process.env.LOCALAI_NARRATION_MODEL ?? 'mistral-7b-instruct';
    this.client = new OpenAI({
      apiKey: 'localai',
      baseURL: `${baseURL}/v1`,
    });
  }

  async generateTurn(input: NarrationInput): Promise<NarrationOutput> {
    const content = await this.callModel(input);
    const parsed = narrationOutputSchema.safeParse(this.parseJson(content));
    if (parsed.success) {
      return parsed.data;
    }

    console.warn('[LocalAINarration] First attempt failed validation, retrying...', parsed.error.message);
    console.warn('[LocalAINarration] Raw output:', content);

    const retryContent = await this.callModel(input, true);
    const retryParsed = narrationOutputSchema.safeParse(this.parseJson(retryContent));
    if (retryParsed.success) {
      return retryParsed.data;
    }

    console.error('[LocalAINarration] Retry also failed, using fallback. Raw:', retryContent);
    return NARRATION_FALLBACK;
  }

  private stripThinkingTokens(content: string): string {
    // Qwen3 and other reasoning models emit <think>...</think> before the actual response
    return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  private parseJson(content: string): unknown {
    const stripped = this.stripThinkingTokens(content);
    try {
      return JSON.parse(stripped);
    } catch {
      // Local models sometimes wrap JSON in markdown code fences
      const match = stripped.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        return JSON.parse(match[1]);
      }
      throw new Error(`Could not parse JSON from: ${stripped.substring(0, 200)}`);
    }
  }

  private async callModel(input: NarrationInput, strict = false): Promise<string> {
    const extra = strict ? '\nCRITICAL: Return ONLY valid JSON matching the exact schema. No markdown, no explanation, no code fences.' : '';
    console.log(`[LocalAINarration] Sending request to ${this.client.baseURL} model=${this.model} strict=${strict}`);
    // console.log(`[LocalAINarration] Input : ${JSON.stringify(input)}`);
    const systemContent = NARRATION_SYSTEM_PROMPT + extra;
    const userContent = buildNarrationUserContent(input);
    // console.log(`[LocalAINarration] Content: ${JSON.stringify({userContent, systemContent })}`);
    const start = Date.now();
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
      ],
      // No response_format here — some local models return empty when forced to JSON mode
      // JSON compliance is enforced via prompt + Zod validation instead
      temperature: 0.2,
    });
    console.log(`[LocalAINarration] Response received in ${Date.now() - start}ms`);
    // console.log(`[LocalAINarration] Response ${JSON.stringify(response)}`);

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('LocalAI returned empty content');
    }
    return content;
  }
}
