import { OPENAI_TTS_VOICES, OPENAI_TTS_VOICES_GPT4O_ONLY, OPENAI_TTS_VOICES_SPEECH_ONLY, resolveTtsVoice, type OpenAiTtsVoice } from '@dnd-fam-ftw/shared';

// How narration audio is produced.
// `realtime`: one short OpenAI Realtime session per narration. The default, because
// OpenAI retires its /audio/speech models on 2027-01-06.
// `speech`: the request/response /audio/speech endpoint, which OpenAI-compatible
// providers implement. Used whenever the operator names a model or a custom endpoint.
export type TtsStrategy = 'speech' | 'realtime';

export interface TtsTarget {
  strategy: TtsStrategy;
  model: string;
  voices: readonly OpenAiTtsVoice[];
  legacyModel: boolean;
}

const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1-mini';
const DEFAULT_SPEECH_MODEL = 'gpt-4o-mini-tts';
const REALTIME_VOICES = OPENAI_TTS_VOICES.filter(voice => !OPENAI_TTS_VOICES_SPEECH_ONLY.has(voice));
const LEGACY_SPEECH_MODELS = new Set(['tts-1', 'tts-1-hd']);

// OpenAI removes these from the API on 2027-01-06 (deprecations notice 2026-10-01).
const RETIRING_OPENAI_MODELS = /^(tts-1|tts-1-hd|gpt-4o-mini-tts)(-\d{4}(-\d{2}-\d{2})?)?$/;

type TtsEnv = { OPENAI_MODEL_TTS?: string; OPENAI_BASE_URL?: string };

// One answer for speech generation, /capabilities and the asset generators.
// Resolved per call: env is read lazily everywhere else in the backend too.
export function resolveTtsTarget(env: TtsEnv = process.env): TtsTarget {
  const override = env.OPENAI_MODEL_TTS || undefined;
  // Realtime is an OpenAI API: a custom endpoint always gets the speech endpoint.
  if (!env.OPENAI_BASE_URL && (!override || override.startsWith('gpt-realtime'))) {
    return { strategy: 'realtime', model: override ?? DEFAULT_REALTIME_MODEL, voices: REALTIME_VOICES, legacyModel: false };
  }
  const model = override ?? DEFAULT_SPEECH_MODEL;
  const legacyModel = LEGACY_SPEECH_MODELS.has(model);
  return {
    strategy: 'speech',
    model,
    voices: legacyModel ? OPENAI_TTS_VOICES.filter(voice => !OPENAI_TTS_VOICES_GPT4O_ONLY.has(voice)) : OPENAI_TTS_VOICES,
    legacyModel,
  };
}

export function resolveEffectiveTtsVoice(requested: OpenAiTtsVoice, target: TtsTarget = resolveTtsTarget()): OpenAiTtsVoice {
  return resolveTtsVoice(requested, target.voices);
}

// An operator override that pins a retiring OpenAI model keeps working until the
// shutdown date, so this only warns. Custom endpoints may serve their own model
// under the same name, so they are left alone.
export function retiringTtsModelWarning(env: TtsEnv = process.env): string | null {
  const model = env.OPENAI_MODEL_TTS;
  if (!model || env.OPENAI_BASE_URL || !RETIRING_OPENAI_MODELS.test(model)) {
    return null;
  }
  return `[TTS] OPENAI_MODEL_TTS=${model} is retired by OpenAI on 2027-01-06. Unset it to use the built-in narrator.`;
}
