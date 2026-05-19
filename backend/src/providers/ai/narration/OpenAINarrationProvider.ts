import { zodResponseFormat } from 'openai/helpers/zod';
import type { NarrationInput, NarrationOutput, NarrationProvider } from './NarrationProvider.js';
import { buildNarrationFallback } from './narrationFallback.js';
import { buildNarrationSystemPrompt, buildNarrationUserContent } from './narrationPrompt.js';
import { parseNarrationOutput } from './narrationOutputGuards.js';
import { narrationOutputSchema } from './narrationSchemas.js';
import { createOpenAIClient, getModelForTier } from '../openAiClient.js';
import { devLog } from '../../../lib/devLog.js';

export class OpenAINarrationProvider implements NarrationProvider {
  async generateTurn(input: NarrationInput): Promise<NarrationOutput> {
    const raw = await this.callModel(input);
    const parsed = parseNarrationOutput(input, raw);
    if (parsed.success) {
      devLog.log('[Narration] attempt-1 guard=pass');
      return parsed.data;
    }

    devLog.warn('[Narration] attempt-1 guard=fail retrying', parsed.error);
    const retryRaw = await this.callModel(input, parsed.error);
    const retryParsed = parseNarrationOutput(input, retryRaw);
    if (retryParsed.success) {
      return {
        ...retryParsed.data,
        narrationRetried: true,
        narrationValidationError: parsed.error,
      };
    }

    devLog.error('[OpenAINarration] Retry also failed, using fallback.', retryParsed.error, 'Raw:', JSON.stringify(retryRaw));
    return {
      ...buildNarrationFallback(input),
      narrationRetried: true,
      narrationFailed: true,
      narrationValidationError: parsed.error,
      narrationRetryValidationError: retryParsed.error,
    };
  }

  private async callModel(input: NarrationInput, validationError?: string): Promise<unknown> {
    const model = getModelForTier('narration');
    const attempt = validationError ? 'retry' : 'attempt-1';
    const start = Date.now();
    const systemPrompt = buildNarrationSystemPrompt(input);
    const userContent = buildNarrationUserContent(input, validationError);
    const isHighStakesTurn = input.encounterState?.status === 'active'
      || input.sceneMomentum?.directive === 'climax_pressure';
    const timeoutMs = isHighStakesTurn ? 60_000 : 50_000;
    const systemChars = systemPrompt.length;
    const userChars = userContent.length;
    const storySummaryChars = input.storySummary ? JSON.stringify(input.storySummary).length : 0;
    const dmPrepChars = input.dmPrep?.length ?? 0;
    const encounterStateChars = input.encounterState ? JSON.stringify(input.encounterState).length : 0;
    const partyChars = JSON.stringify(input.party).length;
    const inventoryChars = JSON.stringify(input.inventory).length;
    const recentHistoryChars = JSON.stringify(input.recentHistory).length;
    const systemApproxTokens = Math.ceil(systemChars / 4);
    const userApproxTokens = Math.ceil(userChars / 4);
    const totalApproxTokens = systemApproxTokens + userApproxTokens;
    devLog.log([
      `[Narration] ${attempt} start`,
      `model=${model}`,
      `timeoutMs=${timeoutMs}`,
      `systemChars=${systemChars}`,
      `userChars=${userChars}`,
      `systemApproxTokens=${systemApproxTokens}`,
      `userApproxTokens=${userApproxTokens}`,
      `totalApproxTokens=${totalApproxTokens}`,
      `storySummaryChars=${storySummaryChars}`,
      `dmPrepChars=${dmPrepChars}`,
      `encounterStateChars=${encounterStateChars}`,
      `partyChars=${partyChars}`,
      `inventoryChars=${inventoryChars}`,
      `recentHistoryChars=${recentHistoryChars}`,
      `party=${input.party.length}`,
      `history=${input.recentHistory.length}`,
      `choices=${input.previousChoiceLabels?.length ?? 0}`,
      `inventory=${input.inventory.length}`,
      `encounters=${input.dmPrepEncounters?.length ?? 0}`,
      `hasEncounterState=${input.encounterState ? 'true' : 'false'}`,
    ].join(' '));
    let response;
    try {
      response = await createOpenAIClient().chat.completions.parse({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        response_format: zodResponseFormat(narrationOutputSchema, 'narration_output'),
        temperature: 0.7,
        max_completion_tokens: 1200,
      }, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error: unknown) {
      const durationMs = Date.now() - start;
      const err = error as { name?: string; status?: number; code?: string; type?: string };
      const constructorName = (error as object)?.constructor?.name ?? '';
      const isTimeout = constructorName === 'APIUserAbortError' || durationMs >= timeoutMs - 250;
      devLog.log([
        `[Narration] ${attempt} error`,
        `model=${model}`,
        `durationMs=${durationMs}`,
        `timeout=${isTimeout}`,
        `name=${constructorName || err.name || 'unknown'}`,
        `status=${err.status ?? 'n/a'}`,
        `code=${err.code ?? 'n/a'}`,
        `type=${err.type ?? 'n/a'}`,
      ].join(' '));
      throw error;
    }
    const durationMs = Date.now() - start;
    const choice = response.choices[0];
    const finishReason = choice.finish_reason ?? 'unknown';
    const usage = response.usage;
    devLog.log([
      `[Narration] ${attempt} done`,
      `model=${model}`,
      `durationMs=${durationMs}`,
      `finishReason=${finishReason}`,
      ...(usage ? [
        `promptTokens=${usage.prompt_tokens}`,
        `completionTokens=${usage.completion_tokens}`,
        `cachedTokens=${(usage as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details?.cached_tokens ?? 0}`,
      ] : []),
    ].join(' '));

    const message = choice.message;
    if (message.refusal) {
      throw new Error(`OpenAI refused: ${message.refusal}`);
    }
    if (finishReason === 'content_filter') {
      throw new Error(`Content filtered by provider (finish_reason=content_filter)`);
    }
    if (!message.parsed) {
      const reason = finishReason === 'length' ? 'output truncated by max_completion_tokens' : 'no parsed structured output';
      throw new Error(`OpenAI response failed: ${reason}`);
    }
    return message.parsed;
  }
}
