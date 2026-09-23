import OpenAI from 'openai';

let _client: OpenAI | null = null;
let loggedBaseUrl = false;

export type OpenAIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type OpenAITextVerbosity = 'low' | 'medium' | 'high';
export type OpenAIServiceTier = 'auto' | 'default' | 'flex' | 'scale' | 'priority';

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

// strict: throw on invalid values instead of warning and ignoring them, for
// settings where "ignored" would silently fall back to provider defaults.
function optionalEnum<T extends string>(envName: string, allowed: readonly T[], strict = false): T | undefined {
  const value = process.env[envName];
  if (!value) {
    return undefined;
  }
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  if (strict) {
    throw new Error(`Invalid ${envName}="${value}". Allowed: ${allowed.join(', ')}`);
  }
  console.warn(`[AI] Ignoring invalid ${envName}="${value}". Allowed: ${allowed.join(', ')}`);
  return undefined;
}

// Unset keeps the SDK default retry count. Evaluation scripts set 0 so every
// physical provider request is counted against their request budget.
export function getOpenAIMaxRetries(): number | undefined {
  const value = process.env.OPENAI_MAX_RETRIES;
  if (value === undefined || value === '') {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid OPENAI_MAX_RETRIES="${value}". Expected a non-negative integer.`);
  }
  return Number(value);
}

export function createOpenAIClient(): OpenAI {
  if (!_client) {
    if (process.env.OPENAI_BASE_URL && !loggedBaseUrl) {
      console.log(`[AI] OpenAI-compatible baseURL=${process.env.OPENAI_BASE_URL}`);
      loggedBaseUrl = true;
    }
    const maxRetries = getOpenAIMaxRetries();
    _client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      ...(process.env.OPENAI_BASE_URL && { baseURL: process.env.OPENAI_BASE_URL }),
      ...(maxRetries !== undefined && { maxRetries }),
    });
  }
  return _client;
}

// Built-in preview model and reasoning defaults are one rollback unit and
// change together: gpt-5.6-luna defaults to medium reasoning, which can spend
// a small helper's whole token budget, so it ships with reasoning "none".
// gpt-4.1-nano retires on 2026-10-23 and must never return as a default.
export const PREVIEW_DEFAULTS = { model: 'gpt-5.6-luna', reasoningEffort: 'none' } as const;

export function getModelForTier(tier: 'narration' | 'preview' | 'async'): string {
  switch (tier) {
  case 'narration':
    return process.env.OPENAI_MODEL_NARRATION ?? 'gpt-4.1-mini';
  case 'preview':
    return process.env.OPENAI_MODEL_PREVIEW ?? PREVIEW_DEFAULTS.model;
  case 'async':
    return process.env.OPENAI_MODEL_ASYNC ?? 'gpt-4.1';
  }
}

export function getNarrationReasoningEffort(): OpenAIReasoningEffort | undefined {
  return optionalEnum('OPENAI_REASONING_EFFORT_NARRATION', REASONING_EFFORTS);
}

// Unset uses the built-in default ("none"). "omit" is the explicit escape
// hatch for endpoints that reject the field and is never sent. Invalid values
// throw: ignoring them would silently enable provider-default reasoning,
// which can consume a helper's whole token budget.
export function getPreviewReasoningEffort(): OpenAIReasoningEffort | undefined {
  const effort = optionalEnum('OPENAI_REASONING_EFFORT_PREVIEW', [...REASONING_EFFORTS, 'omit'] as const, true);
  if (effort === 'omit') {
    return undefined;
  }
  return effort ?? PREVIEW_DEFAULTS.reasoningEffort;
}

export type TierRequestSettings = { reasoning_effort?: OpenAIReasoningEffort };

// Optional per-tier request fields, spread into chat completion requests.
// Preview requests send reasoning_effort unless it is set to "omit", which
// custom endpoints that reject the field need. Resolve with the tier that
// actually serves the request (a narration-tier retry gets narration settings).
export function getTierRequestSettings(tier: 'narration' | 'preview' | 'async'): TierRequestSettings {
  if (tier !== 'preview') {
    return {};
  }
  const effort = getPreviewReasoningEffort();
  return effort ? { reasoning_effort: effort } : {};
}

type CompletionChoiceLike = { finish_reason?: string | null; message?: { content?: string | null } } | undefined;

// A reasoning model can spend a small max_completion_tokens budget before
// writing any visible text. Callers fall back silently on empty output, so
// surface that truncation as a production warning instead of hiding it.
export function warnIfEmptyTruncation(caller: string, model: string, choice: CompletionChoiceLike): boolean {
  const truncated = choice?.finish_reason === 'length' && !choice.message?.content?.trim();
  if (truncated) {
    console.warn(`[AI] ${caller} truncated: empty content with finish_reason=length model=${model}`);
  }
  return truncated;
}

export function getNarrationTextVerbosity(): OpenAITextVerbosity | undefined {
  return optionalEnum('OPENAI_TEXT_VERBOSITY_NARRATION', ['low', 'medium', 'high'] as const);
}

export function getNarrationServiceTier(): OpenAIServiceTier | undefined {
  return optionalEnum('OPENAI_SERVICE_TIER_NARRATION', ['auto', 'default', 'flex', 'scale', 'priority'] as const);
}

export function getOpenAIImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2';
}
