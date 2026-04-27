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
  return { OpenAI, speechCreate };
});

vi.mock('openai', () => ({
  default: mocks.OpenAI,
}));

import { generateSpeech, normalizeTextForSpeech, TTS_MAX_INPUT_CHARS } from './ttsService.js';

const mp3Bytes = new Uint8Array([1, 2, 3, 4]);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.OPENAI_BASE_URL;
  mocks.speechCreate.mockResolvedValue({
    arrayBuffer: async () => mp3Bytes.buffer,
  });
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
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

describe('generateSpeech', () => {
  it('calls OpenAI TTS with the configured model, default voice, instructions, and mp3 format', async () => {
    const result = await generateSpeech('**The door opens.**');

    expect(result).toEqual(Buffer.from(mp3Bytes));
    expect(mocks.OpenAI).toHaveBeenCalledWith({ apiKey: 'test-openai-key' });
    expect(mocks.speechCreate).toHaveBeenCalledWith({
      model: 'gpt-4o-mini-tts',
      voice: 'fable',
      input: 'The door opens.',
      instructions: expect.stringContaining('British fantasy audiobook narrator'),
      response_format: 'mp3',
    });
  });

  it('uses sage for female narration', async () => {
    await generateSpeech('The lantern glows.', 'female');

    expect(mocks.speechCreate).toHaveBeenCalledWith(expect.objectContaining({
      voice: 'sage',
    }));
  });

  it('uses fable for male narration', async () => {
    await generateSpeech('The lantern glows.', 'male');

    expect(mocks.speechCreate).toHaveBeenCalledWith(expect.objectContaining({
      voice: 'fable',
    }));
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
