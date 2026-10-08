import { OPENAI_TTS_DEFAULT_VOICE, type OpenAiTtsVoice } from '@dnd-fam-ftw/shared';
import { createOpenAIClient } from '../providers/ai/openAiClient.js';
import { createPcmToMp3Encoder } from '../providers/ai/mp3Encoder.js';
import { RealtimeSpeechError, speakWithRealtime } from '../providers/ai/realtimeSpeech.js';
import { beginRealtimeSpeechAttempt } from '../providers/ai/usageRecordingFetch.js';
import { checkSpokenTranscript } from './speechTranscriptGuard.js';
import { resolveEffectiveTtsVoice, resolveTtsTarget, type TtsTarget } from './ttsTarget.js';

export { resolveEffectiveTtsVoice };

// Chosen by ear on 2026-10-08: mock-epic but warm, steady enough to hear every turn.
export const TTS_INSTRUCTIONS = 'Speak as the narrator of an epic fantasy saga told by firelight: rich, theatrical and a little over-serious, relishing the dramatic words and letting ominous pauses hang, but warm rather than booming, so it stays pleasant across a whole evening. Play it straight. Give quoted character lines their own personality. Finish every word and sentence fully. Do not sound like an assistant or announcer.';
export const TTS_MAX_INPUT_CHARS = 4096;
// A narration whose spoken words differ from the text is thrown away and tried once more.
const REALTIME_SPEECH_ATTEMPTS = 2;

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

export interface GenerateSpeechOptions {
  // Aborting stops generation, so narration the listener walked away from is not paid for in full.
  signal?: AbortSignal;
  // Asset scripts run without a database; they turn usage recording off.
  recordUsage?: boolean;
}

// Always returns MP3, whichever way the audio was produced.
export async function generateSpeech(text: string, voice: OpenAiTtsVoice = OPENAI_TTS_DEFAULT_VOICE, options: GenerateSpeechOptions = {}): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
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
  const effectiveVoice = resolveEffectiveTtsVoice(voice, target);
  if (target.strategy === 'realtime') {
    return generateRealtimeSpeech(apiKey, input, effectiveVoice, target, options);
  }

  const response = await createOpenAIClient().audio.speech.create({
    model: target.model,
    voice: effectiveVoice,
    input,
    instructions: TTS_INSTRUCTIONS,
    response_format: 'mp3',
  }, { signal: options.signal });

  return Buffer.from(await response.arrayBuffer());
}

async function generateRealtimeSpeech(apiKey: string, input: string, voice: OpenAiTtsVoice, target: TtsTarget, { signal, recordUsage = true }: GenerateSpeechOptions): Promise<Buffer> {
  for (let attempt = 1; attempt <= REALTIME_SPEECH_ATTEMPTS; attempt++) {
    // Every attempt reaches the provider and is billed, so each gets its own usage row.
    const usage = recordUsage ? beginRealtimeSpeechAttempt(target.model, input.length) : null;
    const encoder = createPcmToMp3Encoder();
    let result;
    try {
      result = await speakWithRealtime({
        apiKey,
        model: target.model,
        voice,
        instructions: TTS_INSTRUCTIONS,
        text: input,
        onAudio: pcm => encoder.push(pcm),
        signal,
      });
    } catch (err) {
      usage?.record(false, err instanceof RealtimeSpeechError ? err.usage : null);
      throw err;
    }
    usage?.record(true, result.usage);

    const verdict = checkSpokenTranscript(input, result.transcript);
    if (verdict.ok) {
      return encoder.finish();
    }
    console.warn(`[TTS] Narration audio did not match the text (${verdict.reason}), attempt ${attempt} of ${REALTIME_SPEECH_ATTEMPTS}`);
  }
  // Audio with added or missing words is never returned: the caller falls back instead.
  throw new Error('TTS narration did not match the requested text');
}
