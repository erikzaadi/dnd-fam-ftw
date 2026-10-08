import { describe, expect, it } from 'vitest';
import { OPENAI_TTS_VOICES } from '@dnd-fam-ftw/shared';
import { resolveEffectiveTtsVoice, resolveTtsTarget, retiringTtsModelWarning } from './ttsTarget.js';

describe('resolveTtsTarget', () => {
  it('uses the built-in speech model and every voice by default', () => {
    expect(resolveTtsTarget({})).toEqual({
      strategy: 'speech',
      model: 'gpt-4o-mini-tts',
      voices: OPENAI_TTS_VOICES,
      legacyModel: false,
    });
  });

  it('keeps an operator override on the speech endpoint', () => {
    const target = resolveTtsTarget({ OPENAI_MODEL_TTS: 'kokoro', OPENAI_BASE_URL: 'http://localhost:8080/v1' });

    expect(target.strategy).toBe('speech');
    expect(target.model).toBe('kokoro');
    expect(target.legacyModel).toBe(false);
  });

  it('drops the voices a legacy model cannot speak', () => {
    const target = resolveTtsTarget({ OPENAI_MODEL_TTS: 'tts-1-hd' });

    expect(target.legacyModel).toBe(true);
    expect(target.voices).not.toContain('cedar');
    expect(target.voices).not.toContain('marin');
    expect(target.voices).toContain('ash');
  });
});

describe('resolveEffectiveTtsVoice', () => {
  it('keeps a supported voice', () => {
    expect(resolveEffectiveTtsVoice('sage', resolveTtsTarget({}))).toBe('sage');
  });

  it('falls back to the default voice when the target cannot speak the requested one', () => {
    expect(resolveEffectiveTtsVoice('marin', resolveTtsTarget({ OPENAI_MODEL_TTS: 'tts-1' }))).toBe('ash');
  });
});

describe('retiringTtsModelWarning', () => {
  it('is silent without an override', () => {
    expect(retiringTtsModelWarning({})).toBeNull();
  });

  it.each(['tts-1', 'tts-1-hd', 'tts-1-1106', 'gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-12-15'])('warns when the override pins %s', model => {
    expect(retiringTtsModelWarning({ OPENAI_MODEL_TTS: model })).toContain(model);
  });

  it('leaves custom endpoints alone, which may serve their own model under the same name', () => {
    expect(retiringTtsModelWarning({ OPENAI_MODEL_TTS: 'tts-1', OPENAI_BASE_URL: 'http://localhost:8080/v1' })).toBeNull();
  });

  it('is silent for models that are not retiring', () => {
    expect(retiringTtsModelWarning({ OPENAI_MODEL_TTS: 'kokoro' })).toBeNull();
  });
});
