import { publicAssetUrl } from '../lib/api';
import type { OpenAiTtsVoice } from './ttsTypes';

// Maps voices to the existing male/female sample files until per-voice samples are generated in Bundle B
const SAMPLE_BY_VOICE: Record<OpenAiTtsVoice, string> = {
  cedar:   '/sound/tts/openai-narrator-male.mp3',
  marin:   '/sound/tts/openai-narrator-male.mp3',
  fable:   '/sound/tts/openai-narrator-male.mp3',
  onyx:    '/sound/tts/openai-narrator-male.mp3',
  nova:    '/sound/tts/openai-narrator-male.mp3',
  sage:    '/sound/tts/openai-narrator-female.mp3',
  shimmer: '/sound/tts/openai-narrator-female.mp3',
};

class StaticTtsSampleService {
  private currentAudio: HTMLAudioElement | null = null;
  private _speaking = false;

  public isSupported(): boolean {
    return typeof window !== 'undefined' && typeof Audio !== 'undefined';
  }

  public isSpeaking(): boolean {
    return this._speaking;
  }

  public async play(voice: OpenAiTtsVoice, volume: number): Promise<void> {
    if (!this.isSupported()) {
      return;
    }

    this.stop();
    const url = publicAssetUrl(SAMPLE_BY_VOICE[voice]);

    await new Promise<void>(resolve => {
      const audio = new Audio(url);
      this.currentAudio = audio;
      this._speaking = true;
      audio.volume = Math.max(0, Math.min(1, volume));

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
