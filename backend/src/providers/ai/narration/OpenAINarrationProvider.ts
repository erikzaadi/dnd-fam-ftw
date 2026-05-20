import { zodResponseFormat } from 'openai/helpers/zod';
import type { NarrationInput, NarrationOutput, NarrationProvider, NarrationStreamCallbacks } from './NarrationProvider.js';
import { buildNarrationFallback } from './narrationFallback.js';
import { buildNarrationSystemPrompt, buildNarrationUserContent } from './narrationPrompt.js';
import { parseNarrationOutput } from './narrationOutputGuards.js';
import { narrationOutputSchema } from './narrationSchemas.js';
import { createOpenAIClient, getModelForTier } from '../openAiClient.js';
import { devLog } from '../../../lib/devLog.js';

function extractStreamingFields(snapshot: string): { rollNarration: string | null; narration: string } {
  const rollMatch = /"rollNarration":"((?:[^"\\]|\\.)*)/.exec(snapshot);
  const narrationMatch = /"narration":"((?:[^"\\]|\\.)*)/.exec(snapshot);
  const unescape = (s: string) =>
    s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\r/g, '');
  return {
    rollNarration: rollMatch ? unescape(rollMatch[1]) : null,
    narration: narrationMatch ? unescape(narrationMatch[1]) : '',
  };
}

export class OpenAINarrationProvider implements NarrationProvider {
  async generateTurn(input: NarrationInput, callbacks?: NarrationStreamCallbacks): Promise<NarrationOutput> {
    const raw = await this.callModel(input, undefined, callbacks);
    const parsed = parseNarrationOutput(input, raw);
    if (parsed.success) {
      devLog.log('[Narration] attempt-1 guard=pass');
      return parsed.data;
    }

    devLog.warn('[Narration] attempt-1 guard=fail retrying', parsed.error);
    callbacks?.onAbort();
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

  private async callModel(input: NarrationInput, validationError?: string, callbacks?: NarrationStreamCallbacks): Promise<unknown> {
    const model = getModelForTier('narration');
    const attempt = validationError ? 'retry' : 'attempt-1';
    const start = Date.now();
    const systemPrompt = buildNarrationSystemPrompt(input);
    const userContent = buildNarrationUserContent(input, validationError);
    const isHighStakesTurn = input.encounterState?.status === 'active'
      || input.sceneMomentum?.directive === 'climax_pressure';
    const timeoutMs = isHighStakesTurn ? 25_000 : 50_000;
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

    const stream = createOpenAIClient().chat.completions.stream({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: zodResponseFormat(narrationOutputSchema, 'narration_output'),
      temperature: 0.7,
      max_completion_tokens: isHighStakesTurn ? 1500 : 1300,
      stream_options: { include_usage: true },
    }, { signal: AbortSignal.timeout(timeoutMs) });

    if (callbacks) {
      let emittedNarration = '';
      let emittedRollNarration = '';
      let rollNarrationDoneFired = false;
      stream.on('content', (_delta: string, snapshot: string) => {
        const { rollNarration, narration } = extractStreamingFields(snapshot);
        if (narration.length > emittedNarration.length) {
          if (!rollNarrationDoneFired) {
            rollNarrationDoneFired = true;
            callbacks.onRollNarrationDone?.(rollNarration);
          }
          callbacks.onChunk(narration.slice(emittedNarration.length), 'narration');
          emittedNarration = narration;
        }
        if (rollNarration !== null && rollNarration.length > emittedRollNarration.length) {
          callbacks.onChunk(rollNarration.slice(emittedRollNarration.length), 'rollNarration');
          emittedRollNarration = rollNarration;
        }
      });
    }

    let response: Awaited<ReturnType<typeof stream.finalChatCompletion>>;
    try {
      response = await stream.finalChatCompletion();
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

    if (callbacks) {
      callbacks.onStreamingDone(message.parsed.narration, message.parsed.rollNarration ?? null);
    }

    return message.parsed;
  }
}
