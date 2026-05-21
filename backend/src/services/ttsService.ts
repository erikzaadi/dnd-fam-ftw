import { OPENAI_TTS_VOICES_GPT4O_ONLY, OPENAI_TTS_DEFAULT_VOICE, type OpenAiTtsVoice } from '@dnd-fam-ftw/shared';
import { createOpenAIClient } from '../providers/ai/openAiClient.js';

const TTS_MODEL = process.env.OPENAI_MODEL_TTS ?? 'gpt-4o-mini-tts';
const TTS_INSTRUCTIONS = 'Speak as a refined British fantasy audiobook narrator. Calm, immersive, measured, and elegant. Use clear pronunciation, restrained drama, and natural pauses. Do not sound like an assistant or announcer.';
export const TTS_MAX_INPUT_CHARS = 4096;

export function resolveEffectiveTtsVoice(requested: OpenAiTtsVoice): OpenAiTtsVoice {
  const isLegacyModel = TTS_MODEL === 'tts-1' || TTS_MODEL === 'tts-1-hd';
  if (isLegacyModel && OPENAI_TTS_VOICES_GPT4O_ONLY.has(requested)) {
    console.warn(`[TTS] Voice "${requested}" not supported by ${TTS_MODEL}, falling back to fable`);
    return 'fable';
  }
  return requested;
}

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

  const response = await createOpenAIClient().audio.speech.create({
    model: TTS_MODEL,
    voice,
    input,
    instructions: TTS_INSTRUCTIONS,
    response_format: 'mp3',
  });

  return Buffer.from(await response.arrayBuffer());
}
