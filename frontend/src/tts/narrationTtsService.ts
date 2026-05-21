import { browserTtsService } from './browserTtsService';
import { openAiTtsService } from './openaiTtsService';
import type { TtsSettings, OpenAiTtsVoice } from './ttsTypes';
import { devLog } from '../lib/devLog';

type SpeakNarrationInput = {
  text: string;
  settings: TtsSettings;
  hasTts: boolean;
  turnId?: number | string;
  cacheKey?: string;
  mainNarration?: boolean;
  carMode?: boolean;
};

function voiceFromSettings(settings: TtsSettings): OpenAiTtsVoice {
  return settings.openAiVoice;
}

class NarrationTtsService {
  public isNarrationAvailable(settings: TtsSettings, hasTts: boolean, mainNarration = true): boolean {
    if (!settings.enabled) {
      return false;
    }
    if (mainNarration && settings.provider === 'openai' && hasTts) {
      return openAiTtsService.isSupported() || browserTtsService.isSupported();
    }
    return browserTtsService.isSupported();
  }

  public isNarrationSpeaking(): boolean {
    return openAiTtsService.isSpeaking() || browserTtsService.isSpeaking();
  }

  public stopNarration(): void {
    openAiTtsService.stop();
    browserTtsService.stop();
  }

  public async speakNarration({
    text,
    settings,
    hasTts,
    turnId,
    cacheKey,
    mainNarration = true,
    carMode = false,
  }: SpeakNarrationInput): Promise<void> {
    if (!settings.enabled) {
      return;
    }

    this.stopNarration();

    const shouldUseOpenAi = mainNarration && settings.provider === 'openai' && hasTts && openAiTtsService.isSupported();
    if (shouldUseOpenAi || carMode) {
      try {
        await openAiTtsService.speakNarration({
          text,
          voice: voiceFromSettings(settings),
          turnId,
          cacheKey,
          volume: settings.volume,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
          return;
        }
        devLog.warn('[TTS] OpenAI narration failed:', error);
        return;
      }
    }

    await browserTtsService.speakNarration(text, settings);
  }
}

export const narrationTtsService = new NarrationTtsService();
