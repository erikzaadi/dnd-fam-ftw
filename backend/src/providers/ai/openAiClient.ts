import OpenAI from 'openai';
import { createUsageRecordingFetch } from './usageRecordingFetch.js';

let _client: OpenAI | null = null;
let loggedBaseUrl = false;

export type OpenAIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type OpenAITextVerbosity = 'low' | 'medium' | 'high';
export type OpenAIServiceTier = 'auto' | 'default' | 'flex' | 'scale' | 'priority';

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
// "priority" is OpenAI's Fast mode (renamed 2026-07-30; the SDK type predates "fast").
const SERVICE_TIERS = ['auto', 'default', 'flex', 'scale', 'priority'] as const;

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
      // Unit tests exercise the recorder directly and must not write usage rows.
      ...(!process.env.VITEST && { fetch: createUsageRecordingFetch() }),
    });
  }
  return _client;
}

export type TextTier = 'narration' | 'preview' | 'async';

type TierDefaults = { readonly model: string; readonly reasoningEffort?: OpenAIReasoningEffort };

// Each tier's built-in model and reasoning default are one rollback unit and
// change together: reasoning models such as gpt-5.6-luna and gpt-6-luna default
// to medium reasoning, which can spend a small request's whole token budget, so
// they ship with reasoning "none". Non-reasoning models (gpt-4.1*) reject the
// field, so their defaults send none. gpt-4.1-nano retired on 2026-10-23, and
// gpt-4.1 / gpt-4.1-mini retire on 2027-01-14.
export const PREVIEW_DEFAULTS = { model: 'gpt-5.6-luna', reasoningEffort: 'none' } as const satisfies TierDefaults;
export const NARRATION_DEFAULTS = { model: 'gpt-4.1-mini' } as const satisfies TierDefaults;
export const ASYNC_DEFAULTS = { model: 'gpt-4.1' } as const satisfies TierDefaults;

const TIER_DEFAULTS: Record<TextTier, TierDefaults> = {
  narration: NARRATION_DEFAULTS,
  preview: PREVIEW_DEFAULTS,
  async: ASYNC_DEFAULTS,
};

const TIER_ENV_SUFFIX: Record<TextTier, string> = {
  narration: 'NARRATION',
  preview: 'PREVIEW',
  async: 'ASYNC',
};

export function getModelForTier(tier: TextTier): string {
  return process.env[`OPENAI_MODEL_${TIER_ENV_SUFFIX[tier]}`] ?? TIER_DEFAULTS[tier].model;
}

// OPENAI_REASONING_EFFORT_<TIER>. Unset uses the tier's built-in default.
// "omit" is the explicit escape hatch for endpoints or models that reject the
// field and is never sent. Invalid values throw: ignoring them would silently
// enable provider-default reasoning, which can consume a whole token budget.
export function getTierReasoningEffort(tier: TextTier): OpenAIReasoningEffort | undefined {
  const effort = optionalEnum(`OPENAI_REASONING_EFFORT_${TIER_ENV_SUFFIX[tier]}`, [...REASONING_EFFORTS, 'omit'] as const, true);
  if (effort === 'omit') {
    return undefined;
  }
  return effort ?? TIER_DEFAULTS[tier].reasoningEffort;
}

// OPENAI_SERVICE_TIER_<TIER>. Unset sends nothing (the project's default
// tier). Invalid values throw, like reasoning effort.
export function getTierServiceTier(tier: TextTier): OpenAIServiceTier | undefined {
  return optionalEnum(`OPENAI_SERVICE_TIER_${TIER_ENV_SUFFIX[tier]}`, SERVICE_TIERS, true);
}

// Startup check: throws on the first invalid per-tier request setting.
export function assertTierRequestSettings(): void {
  for (const tier of Object.keys(TIER_DEFAULTS) as TextTier[]) {
    getTierRequestSettings(tier);
  }
}

export type TierRequestSettings = { reasoning_effort?: OpenAIReasoningEffort; service_tier?: OpenAIServiceTier };

// Optional per-tier request fields, spread into chat completion requests.
// Resolve with the tier that actually serves the request (a narration-tier
// retry gets narration settings, never preview ones).
export function getTierRequestSettings(tier: TextTier): TierRequestSettings {
  const effort = getTierReasoningEffort(tier);
  const serviceTier = getTierServiceTier(tier);
  return {
    ...(effort && { reasoning_effort: effort }),
    ...(serviceTier && { service_tier: serviceTier }),
  };
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

export function getOpenAIImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2';
}
