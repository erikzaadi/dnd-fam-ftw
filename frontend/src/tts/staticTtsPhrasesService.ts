import { ttsPhrasesCatalog } from 'virtual:audio-catalog';
import type { OpenAiTtsVoice } from './ttsTypes';

const CACHE_KEY_TO_SLUG: Record<string, string> = {
  'car:v1:prompt:choose-action': 'choose-action',
  'car:v1:prompt:confirm-action': 'confirm-action',
  'car:v1:info:help': 'help',
  'car:v1:status:reconnecting': 'reconnecting',
  'car:v1:status:reconnected': 'reconnected',
  'car:v1:error:retry-prompt': 'retry-prompt',
  'car:v1:orientation': 'orientation',
};

export function getStaticPhrasePath(cacheKey: string, voice: OpenAiTtsVoice): string | null {
  const slug = CACHE_KEY_TO_SLUG[cacheKey];
  if (!slug) {
    return null;
  }
  return ttsPhrasesCatalog[voice]?.[slug] ?? null;
}
