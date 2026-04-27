import { publicAssetUrl } from '../lib/api';
import type { TtsSettings } from './ttsTypes';

const SAMPLE_BY_GENDER = {
  male: '/sound/tts/openai-narrator-male.mp3',
  female: '/sound/tts/openai-narrator-female.mp3',
} as const;

class StaticTtsSampleService {
  private currentAudio: HTMLAudioElement | null = null;
  private _speaking = false;

  public isSupported(): boolean {
    return typeof window !== 'undefined' && typeof Audio !== 'undefined';
  }

  public isSpeaking(): boolean {
    return this._speaking;
  }

  public async play(settings: TtsSettings): Promise<void> {
    if (!this.isSupported()) {
      return;
    }

    this.stop();
    const gender = settings.preferredGenderHint === 'female' ? 'female' : 'male';
    const url = publicAssetUrl(SAMPLE_BY_GENDER[gender]);

    await new Promise<void>(resolve => {
      const audio = new Audio(url);
      this.currentAudio = audio;
      this._speaking = true;
      audio.volume = Math.max(0, Math.min(1, settings.volume));

      const finish = () => {
        if (this.currentAudio === audio) {
          this.currentAudio = null;
        }
        this._speaking = false;
        resolve();
      };

      audio.onended = finish;
      audio.onerror = finish;
      audio.play().catch(finish);
    });
  }

  public stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    this._speaking = false;
  }
}

export const staticTtsSampleService = new StaticTtsSampleService();
