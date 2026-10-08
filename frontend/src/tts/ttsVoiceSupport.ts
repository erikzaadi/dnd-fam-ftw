import { OPENAI_TTS_VOICES, resolveTtsVoice } from '../types';
import type { OpenAiTtsVoice } from './ttsTypes';

// Which narrator voices the server can speak, as reported by /capabilities.
// Module state rather than React state: the narration services are plain
// singletons and every speak call needs the answer.
let supportedVoices: readonly OpenAiTtsVoice[] = OPENAI_TTS_VOICES;

// Unknown ids from a newer server are dropped; a missing or empty list means "all".
export function setSupportedTtsVoices(voices: unknown): readonly OpenAiTtsVoice[] {
  const known = Array.isArray(voices) ? OPENAI_TTS_VOICES.filter(voice => voices.includes(voice)) : [];
  supportedVoices = known.length > 0 ? known : OPENAI_TTS_VOICES;
  return supportedVoices;
}

export function getSupportedTtsVoices(): readonly OpenAiTtsVoice[] {
  return supportedVoices;
}

// The voice that will actually speak for a saved preference. Live narration,
// static phrases and samples all go through this so they never disagree.
export function effectiveTtsVoice(voice: OpenAiTtsVoice): OpenAiTtsVoice {
  return resolveTtsVoice(voice, supportedVoices);
}
