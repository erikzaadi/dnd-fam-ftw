import { afterEach, describe, expect, it } from 'vitest';
import { OPENAI_TTS_VOICES } from '../types';
import { effectiveTtsVoice, getSupportedTtsVoices, setSupportedTtsVoices } from './ttsVoiceSupport';

afterEach(() => {
  setSupportedTtsVoices(undefined);
});

describe('ttsVoiceSupport', () => {
  it('offers every voice until the server says otherwise', () => {
    expect(getSupportedTtsVoices()).toEqual(OPENAI_TTS_VOICES);
    expect(effectiveTtsVoice('fable')).toBe('fable');
  });

  it('treats a missing or empty list from an older server as every voice', () => {
    expect(setSupportedTtsVoices(undefined)).toEqual(OPENAI_TTS_VOICES);
    expect(setSupportedTtsVoices([])).toEqual(OPENAI_TTS_VOICES);
  });

  it('keeps only known voice ids, in the app order', () => {
    expect(setSupportedTtsVoices(['sage', 'voice-from-the-future', 'ash'])).toEqual(['ash', 'sage']);
  });

  it('speaks the default voice for a saved voice the server cannot speak', () => {
    setSupportedTtsVoices(['ash', 'cedar', 'marin', 'sage', 'shimmer']);

    expect(effectiveTtsVoice('fable')).toBe('ash');
    expect(effectiveTtsVoice('cedar')).toBe('cedar');
  });

  it('speaks the first supported voice when even the default is unavailable', () => {
    setSupportedTtsVoices(['sage', 'shimmer']);

    expect(effectiveTtsVoice('cedar')).toBe('sage');
  });
});
