import { zodResponseFormat } from 'openai/helpers/zod';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import type { NarrationInput, NarrationOutput, NarrationProvider, NarrationStreamCallbacks } from './NarrationProvider.js';
import { buildNarrationFallback } from './narrationFallback.js';
import { buildNarrationSystemPrompt, buildNarrationUserContent } from './narrationPrompt.js';
import { parseNarrationOutput } from './narrationOutputGuards.js';
import { narrationOutputSchema } from './narrationSchemas.js';
import {
  createOpenAIClient,
  getModelForTier,
  getNarrationReasoningEffort,
  getNarrationServiceTier,
  getNarrationTextVerbosity,
} from '../openAiClient.js';
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

function supportsCustomTemperature(model: string): boolean {
  return !/^gpt-5(?:[.-]|$)/i.test(model);
}

function narrationMaxCompletionTokens(model: string, isHighStakesTurn: boolean): number {
  if (/^gpt-5(?:[.-]|$)/i.test(model)) {
    return isHighStakesTurn ? 2600 : 2200;
  }
  return isHighStakesTurn ? 1500 : 1300;
}

function effectiveReasoningEffort(model: string, configured: ReturnType<typeof getNarrationReasoningEffort>): ReturnType<typeof getNarrationReasoningEffort> {
  if (configured) {
    return configured;
  }
  return /^gpt-5(?:[.-]|$)/i.test(model) ? 'low' : undefined;
}

function isYellowCardValidationError(error: string): boolean {
  return (
    error.includes('Output revives recently resolved threat') ||
    error.includes('Narration repeats vague atmosphere filler') ||
    error.includes('Narration repeats the previous turn too closely')
  );
}

export class OpenAINarrationProvider implements NarrationProvider {
  async generateTurn(input: NarrationInput, callbacks?: NarrationStreamCallbacks): Promise<NarrationOutput> {
    const raw = await this.callModel(input, undefined, callbacks);
    const parsed = parseNarrationOutput(input, raw);
    if (parsed.success) {
      devLog.log('[Narration] attempt-1 guard=pass');
      return parsed.data;
    }

    if (isYellowCardValidationError(parsed.error)) {
      const relaxed = parseNarrationOutput(input, raw, { enforceGameplayGuards: false });
      if (relaxed.success) {
        devLog.warn('[Narration] attempt-1 guard=yellow-card accepting', parsed.error);
        return {
          ...relaxed.data,
          narrationValidationError: parsed.error,
        };
      }
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

    if (isYellowCardValidationError(retryParsed.error)) {
      const relaxedRetry = parseNarrationOutput(input, retryRaw, { enforceGameplayGuards: false });
      if (relaxedRetry.success) {
        devLog.warn('[Narration] retry guard=yellow-card accepting', retryParsed.error);
        return {
          ...relaxedRetry.data,
          narrationRetried: true,
          narrationValidationError: parsed.error,
          narrationRetryValidationError: retryParsed.error,
        };
      }
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
    const reasoningEffort = effectiveReasoningEffort(model, getNarrationReasoningEffort());
    const textVerbosity = getNarrationTextVerbosity();
    const serviceTier = getNarrationServiceTier();
    const attempt = validationError ? 'retry' : 'attempt-1';
    const start = Date.now();
    const systemPrompt = buildNarrationSystemPrompt(input);
    const userContent = buildNarrationUserContent(input, validationError);
    const isHighStakesTurn = input.encounterState?.status === 'active'
      || input.sceneMomentum?.directive === 'climax_pressure';
    const timeoutMs = isHighStakesTurn ? 45_000 : 50_000;
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
      `reasoningEffort=${reasoningEffort ?? 'default'}`,
      `verbosity=${textVerbosity ?? 'default'}`,
      `serviceTier=${serviceTier ?? 'default'}`,
    ].join(' '));

    const request: ChatCompletionCreateParamsStreaming = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: zodResponseFormat(narrationOutputSchema, 'narration_output'),
      max_completion_tokens: narrationMaxCompletionTokens(model, isHighStakesTurn),
      stream: true,
      stream_options: { include_usage: true },
      ...(supportsCustomTemperature(model) && { temperature: 0.7 }),
      ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
      ...(textVerbosity && { verbosity: textVerbosity }),
      ...(serviceTier && { service_tier: serviceTier }),
    };

    const stream = createOpenAIClient().chat.completions.stream(request, { signal: AbortSignal.timeout(timeoutMs) });

    let firstRollChunkMs: number | null = null;
    let firstNarrationChunkMs: number | null = null;
    let streamingDoneMs: number | null = null;
    if (callbacks) {
      let emittedNarration = '';
      let emittedRollNarration = '';
      let rollNarrationDoneFired = false;
      stream.on('content', (_delta: string, snapshot: string) => {
        const { rollNarration, narration } = extractStreamingFields(snapshot);
        if (narration.length > emittedNarration.length) {
          firstNarrationChunkMs ??= Date.now() - start;
          if (!rollNarrationDoneFired) {
            rollNarrationDoneFired = true;
            callbacks.onRollNarrationDone?.(rollNarration);
          }
          callbacks.onChunk(narration.slice(emittedNarration.length), 'narration');
          emittedNarration = narration;
        }
        if (rollNarration !== null && rollNarration.length > emittedRollNarration.length) {
          firstRollChunkMs ??= Date.now() - start;
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
    const promptDetails = usage as { prompt_tokens_details?: { cached_tokens?: number } } | undefined;
    const completionDetails = usage as { completion_tokens_details?: { reasoning_tokens?: number } } | undefined;
    if (callbacks) {
      streamingDoneMs = durationMs;
    }
    devLog.log([
      `[Narration] ${attempt} done`,
      `model=${model}`,
      `durationMs=${durationMs}`,
      `finishReason=${finishReason}`,
      `firstRollChunkMs=${firstRollChunkMs ?? 'n/a'}`,
      `firstNarrationChunkMs=${firstNarrationChunkMs ?? 'n/a'}`,
      `streamingDoneMs=${streamingDoneMs ?? 'n/a'}`,
      `reasoningEffort=${reasoningEffort ?? 'default'}`,
      `verbosity=${textVerbosity ?? 'default'}`,
      `requestedServiceTier=${serviceTier ?? 'default'}`,
      `responseServiceTier=${(response as { service_tier?: string | null }).service_tier ?? 'n/a'}`,
      ...(usage ? [
        `promptTokens=${usage.prompt_tokens}`,
        `completionTokens=${usage.completion_tokens}`,
        `cachedTokens=${promptDetails?.prompt_tokens_details?.cached_tokens ?? 0}`,
        `reasoningTokens=${completionDetails?.completion_tokens_details?.reasoning_tokens ?? 0}`,
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
    const parsedOutput = message.parsed as NarrationOutput;

    if (callbacks) {
      callbacks.onStreamingDone(parsedOutput.narration, parsedOutput.rollNarration ?? null);
    }

    return parsedOutput;
  }
}
