import { browserTtsService } from './browserTtsService';
import { openAiTtsService } from './openaiTtsService';
import type { TtsSettings, OpenAiTtsVoice } from './ttsTypes';
import { devLog } from '../lib/devLog';
import { effectiveTtsVoice } from './ttsVoiceSupport';

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
  return effectiveTtsVoice(settings.openAiVoice);
}

class NarrationTtsService {
  // Bumped by every stop, so a failed AI request can tell whether it is still wanted.
  private generation = 0;

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
    this.generation += 1;
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
    const generation = this.generation;

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
        // Stopped, replaced by newer narration, or blocked by autoplay rules:
        // the player did not ask to hear this, so nothing else may start speaking.
        if (generation !== this.generation) {
          return;
        }
        if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
          return;
        }
        // The AI narrator failed (provider error, timeout, not configured):
        // this one utterance falls back to the device voice.
        devLog.warn('[TTS] AI narration failed, using the browser voice:', error);
        if (!browserTtsService.isSupported()) {
          return;
        }
      }
    }

    await browserTtsService.speakNarration(text, settings);
  }
}

export const narrationTtsService = new NarrationTtsService();
