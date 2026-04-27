import OpenAI from 'openai';

const TTS_MODEL = 'gpt-4o-mini-tts';
const TTS_VOICE_MALE = 'fable';
const TTS_VOICE_FEMALE = 'sage';
const TTS_INSTRUCTIONS = 'Speak as a refined British fantasy audiobook narrator. Calm, immersive, measured, and elegant. Use clear pronunciation, restrained drama, and natural pauses. Do not sound like an assistant or announcer.';
export const TTS_MAX_INPUT_CHARS = 4096;

export type TtsGender = 'male' | 'female';

let _openai: OpenAI | null = null;
const openai = () => (_openai ??= new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_BASE_URL && { baseURL: process.env.OPENAI_BASE_URL }),
}));

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

export async function generateSpeech(text: string, gender?: TtsGender): Promise<Buffer> {
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

  const response = await openai().audio.speech.create({
    model: TTS_MODEL,
    voice: gender === 'female' ? TTS_VOICE_FEMALE : TTS_VOICE_MALE,
    input,
    instructions: TTS_INSTRUCTIONS,
    response_format: 'mp3',
  });

  return Buffer.from(await response.arrayBuffer());
}
