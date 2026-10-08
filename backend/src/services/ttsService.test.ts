import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const speechCreate = vi.fn();
  const OpenAI = vi.fn(function OpenAIMock() {
    return {
      audio: {
        speech: {
          create: speechCreate,
        },
      },
    };
  });
  const speakWithRealtime = vi.fn();
  const recordUsage = vi.fn();
  const beginRealtimeSpeechAttempt = vi.fn(() => ({ record: recordUsage }));
  return { OpenAI, speechCreate, speakWithRealtime, recordUsage, beginRealtimeSpeechAttempt };
});

vi.mock('openai', () => ({
  default: mocks.OpenAI,
}));

vi.mock('../providers/ai/realtimeSpeech.js', async importOriginal => ({
  ...await importOriginal<typeof import('../providers/ai/realtimeSpeech.js')>(),
  speakWithRealtime: mocks.speakWithRealtime,
}));

vi.mock('../providers/ai/usageRecordingFetch.js', async importOriginal => ({
  ...await importOriginal<typeof import('../providers/ai/usageRecordingFetch.js')>(),
  beginRealtimeSpeechAttempt: mocks.beginRealtimeSpeechAttempt,
}));

import { RealtimeSpeechError, type RealtimeSpeechRequest } from '../providers/ai/realtimeSpeech.js';
import { generateSpeech, normalizeTextForSpeech, TTS_MAX_INPUT_CHARS } from './ttsService.js';

const mp3Bytes = new Uint8Array([1, 2, 3, 4]);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.OPENAI_BASE_URL;
  // An operator-named model keeps the /audio/speech endpoint; unset means Realtime.
  process.env.OPENAI_MODEL_TTS = 'gpt-4o-mini-tts';
  mocks.speechCreate.mockResolvedValue({
    arrayBuffer: async () => mp3Bytes.buffer,
  });
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL_TTS;
});

describe('normalizeTextForSpeech', () => {
  it('strips common markdown while preserving readable text', () => {
    const normalized = normalizeTextForSpeech('# Title\n**Bold** and *italic* with `code` plus [a link](https://example.com)');
    expect(normalized).toBe('Title\nBold and italic with code plus a link');
  });

  it('collapses repeated whitespace and trims', () => {
    expect(normalizeTextForSpeech('  The   party\n\n advances.  ')).toBe('The party advances.');
  });
});

describe('generateSpeech on the speech endpoint', () => {
  it('calls OpenAI TTS with the configured model, default voice, instructions, and mp3 format', async () => {
    const result = await generateSpeech('**The door opens.**');

    expect(result).toEqual(Buffer.from(mp3Bytes));
    expect(mocks.OpenAI).toHaveBeenCalledWith({ apiKey: 'test-openai-key' });
    expect(mocks.speechCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini-tts',
      voice: 'ash',
      input: 'The door opens.',
      instructions: expect.stringContaining('epic fantasy saga'),
      response_format: 'mp3',
    }), expect.anything());
    expect(mocks.speakWithRealtime).not.toHaveBeenCalled();
  });


  it('uses sage voice', async () => {
    await generateSpeech('The lantern glows.', 'sage');

    expect(mocks.speechCreate).toHaveBeenCalledWith(expect.objectContaining({
      voice: 'sage',
    }), expect.anything());
  });

  it('uses fable voice', async () => {
    await generateSpeech('The lantern glows.', 'fable');

    expect(mocks.speechCreate).toHaveBeenCalledWith(expect.objectContaining({
      voice: 'fable',
    }), expect.anything());
  });

  it('speaks with the default voice when a legacy model cannot speak the requested one', async () => {
    process.env.OPENAI_MODEL_TTS = 'tts-1';

    await generateSpeech('The lantern glows.', 'cedar');

    expect(mocks.speechCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'tts-1',
      voice: 'ash',
    }), expect.anything());
  });

  it('throws before calling OpenAI when the API key is missing', async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(generateSpeech('Hello')).rejects.toThrow('not configured');
    expect(mocks.speechCreate).not.toHaveBeenCalled();
  });

  it('throws before calling OpenAI when normalized input is empty', async () => {
    await expect(generateSpeech('   ')).rejects.toThrow('empty');
    expect(mocks.speechCreate).not.toHaveBeenCalled();
  });

  it('throws before calling OpenAI when input exceeds the SDK character limit', async () => {
    await expect(generateSpeech('a'.repeat(TTS_MAX_INPUT_CHARS + 1))).rejects.toThrow(`${TTS_MAX_INPUT_CHARS}`);
    expect(mocks.speechCreate).not.toHaveBeenCalled();
  });
});

describe('generateSpeech with the built-in Realtime narrator', () => {
  const TEXT = 'The old oak creaks open.';
  // A tenth of a second of silence is enough for the encoder to produce a frame.
  const speaks = (transcript: string) => async (request: RealtimeSpeechRequest) => {
    request.onAudio(Buffer.alloc(4800));
    return { transcript, usage: { inputTokens: 10, outputTokens: 20, textInputTokens: 10, textOutputTokens: 5, audioOutputTokens: 15 } };
  };

  beforeEach(() => {
    delete process.env.OPENAI_MODEL_TTS;
  });

  it('speaks the text with the Realtime model and returns MP3', async () => {
    mocks.speakWithRealtime.mockImplementation(speaks(TEXT));

    const audio = await generateSpeech(`**${TEXT}**`, 'sage');

    expect(mocks.speakWithRealtime).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'test-openai-key',
      model: 'gpt-realtime-2.1-mini',
      voice: 'sage',
      text: TEXT,
      instructions: expect.stringContaining('epic fantasy saga'),
    }));
    expect(audio[0]).toBe(0xff);
    expect(mocks.speechCreate).not.toHaveBeenCalled();
    expect(mocks.beginRealtimeSpeechAttempt).toHaveBeenCalledWith('gpt-realtime-2.1-mini', TEXT.length);
    expect(mocks.recordUsage).toHaveBeenCalledWith(true, expect.objectContaining({ audioOutputTokens: 15 }));
  });

  it('speaks the default voice for a voice Realtime does not have', async () => {
    mocks.speakWithRealtime.mockImplementation(speaks(TEXT));

    await generateSpeech(TEXT, 'fable');

    expect(mocks.speakWithRealtime).toHaveBeenCalledWith(expect.objectContaining({ voice: 'ash' }));
  });

  it('throws away audio with added words and tries once more', async () => {
    mocks.speakWithRealtime
      .mockImplementationOnce(speaks(`Sure, here it is. ${TEXT}`))
      .mockImplementationOnce(speaks(TEXT));

    const audio = await generateSpeech(TEXT);

    expect(audio.length).toBeGreaterThan(0);
    expect(mocks.speakWithRealtime).toHaveBeenCalledTimes(2);
    expect(mocks.recordUsage).toHaveBeenCalledTimes(2);
  });

  it('fails instead of returning audio that still does not match the text', async () => {
    mocks.speakWithRealtime.mockImplementation(speaks(`Sure, here it is. ${TEXT}`));

    await expect(generateSpeech(TEXT)).rejects.toThrow('did not match');
    expect(mocks.speakWithRealtime).toHaveBeenCalledTimes(2);
  });

  it('records a failed attempt with whatever usage the provider reported, without retrying', async () => {
    const usage = { inputTokens: 10, outputTokens: 2, textInputTokens: 10, textOutputTokens: 2, audioOutputTokens: 0 };
    mocks.speakWithRealtime.mockRejectedValue(new RealtimeSpeechError('Realtime speech failed: boom', usage));

    await expect(generateSpeech(TEXT)).rejects.toThrow('boom');
    expect(mocks.speakWithRealtime).toHaveBeenCalledTimes(1);
    expect(mocks.recordUsage).toHaveBeenCalledWith(false, usage);
  });

  it('passes the cancel signal through', async () => {
    mocks.speakWithRealtime.mockImplementation(speaks(TEXT));
    const controller = new AbortController();

    await generateSpeech(TEXT, 'ash', { signal: controller.signal });

    expect(mocks.speakWithRealtime).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  });

  it('keeps the speech endpoint for a custom OpenAI-compatible server', async () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:8080/v1';

    await generateSpeech(TEXT);

    expect(mocks.speechCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o-mini-tts' }), expect.anything());
    expect(mocks.speakWithRealtime).not.toHaveBeenCalled();
  });
});
