import { OPENAI_TTS_DEFAULT_VOICE, type OpenAiTtsVoice } from '@dnd-fam-ftw/shared';
import { createOpenAIClient } from '../providers/ai/openAiClient.js';
import { resolveEffectiveTtsVoice, resolveTtsTarget } from './ttsTarget.js';

export { resolveEffectiveTtsVoice };

// Chosen by ear on 2026-10-08: mock-epic but warm, steady enough to hear every turn.
export const TTS_INSTRUCTIONS = 'Speak as the narrator of an epic fantasy saga told by firelight: rich, theatrical and a little over-serious, relishing the dramatic words and letting ominous pauses hang, but warm rather than booming, so it stays pleasant across a whole evening. Play it straight. Give quoted character lines their own personality. Finish every word and sentence fully. Do not sound like an assistant or announcer.';
export const TTS_MAX_INPUT_CHARS = 4096;

export function normalizeTextForSpeech(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function generateSpeech(text: string, voice: OpenAiTtsVoice = OPENAI_TTS_DEFAULT_VOICE): Promise<Buffer> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI TTS is not configured');
  }

  const input = normalizeTextForSpeech(text);
  if (!input) {
    throw new Error('TTS input is empty');
  }
  if (input.length > TTS_MAX_INPUT_CHARS) {
    throw new Error(`TTS input exceeds ${TTS_MAX_INPUT_CHARS} characters`);
  }

  const target = resolveTtsTarget();
  const response = await createOpenAIClient().audio.speech.create({
    model: target.model,
    voice: resolveEffectiveTtsVoice(voice, target),
    input,
    instructions: TTS_INSTRUCTIONS,
    response_format: 'mp3',
  });

  return Buffer.from(await response.arrayBuffer());
}
