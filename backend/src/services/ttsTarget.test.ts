import { describe, expect, it } from 'vitest';
import { resolveEffectiveTtsVoice, resolveTtsTarget, retiringTtsModelWarning } from './ttsTarget.js';

describe('resolveTtsTarget', () => {
  it('uses the Realtime narrator and only the voices it can speak by default', () => {
    expect(resolveTtsTarget({})).toEqual({
      strategy: 'realtime',
      model: 'gpt-realtime-2.1-mini',
      voices: ['ash', 'cedar', 'marin', 'sage', 'shimmer'],
      legacyModel: false,
    });
  });

  it('lets the operator pick another Realtime model', () => {
    expect(resolveTtsTarget({ OPENAI_MODEL_TTS: 'gpt-realtime-2.1' })).toMatchObject({ strategy: 'realtime', model: 'gpt-realtime-2.1' });
  });

  it('uses the speech endpoint and every voice for an operator-named speech model', () => {
    const target = resolveTtsTarget({ OPENAI_MODEL_TTS: 'gpt-4o-mini-tts' });

    expect(target.strategy).toBe('speech');
    expect(target.voices).toContain('fable');
  });

  it('uses the speech endpoint for a custom endpoint, even without a model override', () => {
    expect(resolveTtsTarget({ OPENAI_BASE_URL: 'http://localhost:8080/v1' })).toMatchObject({ strategy: 'speech', model: 'gpt-4o-mini-tts' });
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

  it('falls back to the default voice for the voices Realtime does not have', () => {
    expect(resolveEffectiveTtsVoice('fable', resolveTtsTarget({}))).toBe('ash');
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
