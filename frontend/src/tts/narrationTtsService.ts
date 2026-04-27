import { browserTtsService } from './browserTtsService';
import { openAiTtsService } from './openaiTtsService';
import type { TtsSettings } from './ttsTypes';

const isDev = import.meta.env.DEV;

type SpeakNarrationInput = {
  text: string;
  settings: TtsSettings;
  hasTts: boolean;
  turnId?: number | string;
  mainNarration?: boolean;
};

function genderFromSettings(settings: TtsSettings): 'male' | 'female' | undefined {
  return settings.preferredGenderHint === 'female' ? 'female' : undefined;
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
    mainNarration = true,
  }: SpeakNarrationInput): Promise<void> {
    if (!settings.enabled) {
      return;
    }

    this.stopNarration();

    const shouldUseOpenAi = mainNarration && settings.provider === 'openai' && hasTts && openAiTtsService.isSupported();
    if (shouldUseOpenAi) {
      try {
        await openAiTtsService.speakNarration({
          text,
          gender: genderFromSettings(settings),
          turnId,
          volume: settings.volume,
        });
        return;
      } catch (error) {
        if (isDev) {
          console.warn('[TTS] OpenAI narration failed, falling back to browser TTS:', error);
        }
      }
    }

    await browserTtsService.speakNarration(text, settings);
  }
}

export const narrationTtsService = new NarrationTtsService();
