// Estimated provider prices, used for usage limits and reporting only. The provider's
// billing dashboard stays the source of truth. USD per 1M tokens.
// Override or extend with USAGE_MODEL_PRICES='{"model":{"input":0.4,"output":1.6}}'.

export type UsageKind = 'text' | 'image' | 'tts';

interface TokenPrice {
  input: number;
  output: number;
}

const KNOWN_PRICES: Record<string, TokenPrice> = {
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-image-1': { input: 5, output: 40 },
  'gpt-image-1-mini': { input: 2, output: 8 },
};

// Unknown models are priced conservatively so limits err on the safe side.
const FALLBACK_TEXT_PRICE: TokenPrice = { input: 2, output: 8 };
const FALLBACK_IMAGE_PRICE: TokenPrice = { input: 5, output: 40 };
// Used when an image response carries no token usage.
const FALLBACK_IMAGE_COST_USD = 0.02;
// Roughly 1000 characters per minute of speech at about $0.015/minute.
const TTS_COST_PER_MILLION_CHARACTERS = 15;

// Realtime speech is billed per token, with audio output far above text.
// List prices on 2026-10-08, USD per 1M tokens.
interface RealtimeSpeechPrice {
  textInput: number;
  textOutput: number;
  audioOutput: number;
}

const REALTIME_SPEECH_PRICES: Record<string, RealtimeSpeechPrice> = {
  'gpt-realtime-2.1-mini': { textInput: 0.6, textOutput: 2.4, audioOutput: 20 },
  'gpt-realtime-2.1': { textInput: 4, textOutput: 24, audioOutput: 64 },
};
// A probe on 2026-10-04 cost about $34 per 1M characters on gpt-realtime-2.1-mini.
const REALTIME_SPEECH_COST_PER_MILLION_CHARACTERS = 35;

let parsedOverrides: Record<string, TokenPrice> | null = null;

function priceOverrides(): Record<string, TokenPrice> {
  if (parsedOverrides) {
    return parsedOverrides;
  }
  parsedOverrides = {};
  const raw = process.env.USAGE_MODEL_PRICES?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, Partial<TokenPrice>>;
      for (const [model, price] of Object.entries(parsed)) {
        if (typeof price.input === 'number' && typeof price.output === 'number') {
          parsedOverrides[model] = { input: price.input, output: price.output };
        }
      }
    } catch {
      console.warn('[Usage] Ignoring invalid USAGE_MODEL_PRICES JSON');
    }
  }
  return parsedOverrides;
}

function priceFor(model: string | null, kind: UsageKind): TokenPrice {
  const fallback = kind === 'image' ? FALLBACK_IMAGE_PRICE : FALLBACK_TEXT_PRICE;
  if (!model) {
    return fallback;
  }
  const overrides = priceOverrides();
  if (overrides[model]) {
    return overrides[model];
  }
  if (KNOWN_PRICES[model]) {
    return KNOWN_PRICES[model];
  }
  // Dated snapshots, e.g. gpt-4.1-mini-2025-04-14.
  const base = Object.keys(KNOWN_PRICES)
    .filter(name => model.startsWith(`${name}-`))
    .sort((a, b) => b.length - a.length)[0];
  return base ? KNOWN_PRICES[base] : fallback;
}

export interface CostInput {
  kind: UsageKind;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  ttsCharacters: number | null;
  imageCount: number | null;
}

export function estimateCostUsd(input: CostInput): number {
  if (input.kind === 'tts') {
    return ((input.ttsCharacters ?? 0) / 1_000_000) * TTS_COST_PER_MILLION_CHARACTERS;
  }
  if (input.inputTokens === null && input.outputTokens === null) {
    return input.kind === 'image' ? FALLBACK_IMAGE_COST_USD * Math.max(1, input.imageCount ?? 1) : 0;
  }
  const price = priceFor(input.model, input.kind);
  return ((input.inputTokens ?? 0) * price.input + (input.outputTokens ?? 0) * price.output) / 1_000_000;
}

export interface RealtimeSpeechCostInput {
  model: string;
  textInputTokens: number | null;
  textOutputTokens: number | null;
  audioOutputTokens: number | null;
  ttsCharacters: number;
}

// Falls back to a per-character estimate for an unknown model or a response without token details.
export function estimateRealtimeSpeechCostUsd(input: RealtimeSpeechCostInput): number {
  const price = REALTIME_SPEECH_PRICES[input.model];
  if (!price || input.audioOutputTokens === null) {
    return (input.ttsCharacters / 1_000_000) * REALTIME_SPEECH_COST_PER_MILLION_CHARACTERS;
  }
  return (
    (input.textInputTokens ?? 0) * price.textInput +
    (input.textOutputTokens ?? 0) * price.textOutput +
    input.audioOutputTokens * price.audioOutput
  ) / 1_000_000;
}
