import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtsSettings } from './ttsTypes';

const mocks = vi.hoisted(() => ({
  openAi: {
    isSupported: vi.fn(() => true),
    isSpeaking: vi.fn(() => false),
    stop: vi.fn(),
    speakNarration: vi.fn(),
  },
  browser: {
    isSupported: vi.fn(() => true),
    isSpeaking: vi.fn(() => false),
    stop: vi.fn(),
    speakNarration: vi.fn(),
  },
}));

vi.mock('./openaiTtsService', () => ({ openAiTtsService: mocks.openAi }));
vi.mock('./browserTtsService', () => ({ browserTtsService: mocks.browser }));

import { narrationTtsService } from './narrationTtsService';

const settings: TtsSettings = {
  enabled: true,
  autoSpeakNarration: true,
  provider: 'openai',
  volume: 1,
  rate: 1,
  pitch: 1,
  preferredVoiceURI: null,
  preferredVoiceName: null,
  preferredLang: null,
  preferredStyle: 'neutral',
  browserGenderHint: 'any',
  openAiVoice: 'ash',
  openAiVoiceChosen: false,
};

const speak = (overrides: Partial<Parameters<typeof narrationTtsService.speakNarration>[0]> = {}) =>
  narrationTtsService.speakNarration({ text: 'The door creaks open.', settings, hasTts: true, ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openAi.isSupported.mockReturnValue(true);
  mocks.browser.isSupported.mockReturnValue(true);
  mocks.openAi.speakNarration.mockResolvedValue(undefined);
  mocks.browser.speakNarration.mockResolvedValue(undefined);
});

describe('narrationTtsService.speakNarration', () => {
  it('uses the AI narrator alone when it succeeds', async () => {
    await speak();

    expect(mocks.openAi.speakNarration).toHaveBeenCalledWith(expect.objectContaining({ text: 'The door creaks open.', voice: 'ash' }));
    expect(mocks.browser.speakNarration).not.toHaveBeenCalled();
  });

  it('falls back to the browser voice when the AI narrator fails', async () => {
    mocks.openAi.speakNarration.mockRejectedValue(new Error('OpenAI TTS failed with 502'));

    await speak();

    expect(mocks.browser.speakNarration).toHaveBeenCalledWith('The door creaks open.', settings);
  });

  it('falls back in car mode too, which always tries the AI narrator first', async () => {
    mocks.openAi.speakNarration.mockRejectedValue(new Error('OpenAI TTS failed with 503'));

    await speak({ carMode: true, hasTts: false, settings: { ...settings, provider: 'browser' } });

    expect(mocks.openAi.speakNarration).toHaveBeenCalled();
    expect(mocks.browser.speakNarration).toHaveBeenCalled();
  });

  it('stays silent when the request was aborted', async () => {
    mocks.openAi.speakNarration.mockRejectedValue(new DOMException('aborted', 'AbortError'));

    await speak();

    expect(mocks.browser.speakNarration).not.toHaveBeenCalled();
  });

  it('stays silent when autoplay was blocked', async () => {
    mocks.openAi.speakNarration.mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));

    await speak();

    expect(mocks.browser.speakNarration).not.toHaveBeenCalled();
  });

  it('stays silent when narration was stopped while the AI request was failing', async () => {
    mocks.openAi.speakNarration.mockImplementation(async () => {
      narrationTtsService.stopNarration();
      throw new Error('OpenAI TTS failed with 502');
    });

    await speak();

    expect(mocks.browser.speakNarration).not.toHaveBeenCalled();
  });

  it('stays silent after a failure on a device without browser speech', async () => {
    mocks.openAi.speakNarration.mockRejectedValue(new Error('OpenAI TTS failed with 502'));
    mocks.browser.isSupported.mockReturnValue(false);

    await speak();

    expect(mocks.browser.speakNarration).not.toHaveBeenCalled();
  });

  it('does nothing when narration is turned off', async () => {
    await speak({ settings: { ...settings, enabled: false } });

    expect(mocks.openAi.speakNarration).not.toHaveBeenCalled();
    expect(mocks.browser.speakNarration).not.toHaveBeenCalled();
  });
});
