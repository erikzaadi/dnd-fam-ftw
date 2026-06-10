import type { AudioSettings } from './audioTypes';

// AbortError just means a pause() interrupted a pending play() - expected when
// tracked sfx (e.g. the narrating whoosh) are cut short by the next event.
function warnUnlessAborted(e: unknown) {
  if (e instanceof Error && e.name === 'AbortError') {
    return;
  }
  console.warn('[SfxPlayer] Playback failed', e);
}

export class SfxPlayer {
  private settings: AudioSettings;

  constructor(settings: AudioSettings) {
    this.settings = settings;
  }

  public updateSettings(settings: AudioSettings) {
    this.settings = settings;
  }

  public play(path: string) {
    if (!this.settings.enabled || !this.settings.sfxEnabled || this.settings.masterMuted) {
      return;
    }
    const audio = new Audio(path);
    audio.volume = this.settings.sfxVolume;
    audio.play().catch(warnUnlessAborted);
  }

  public playRandom(options: readonly string[]) {
    if (options.length === 0) {
      return;
    }
    const path = options[Math.floor(Math.random() * options.length)];
    this.play(path);
  }

  public playRandomTracked(options: readonly string[]): HTMLAudioElement | null {
    if (options.length === 0 || !this.settings.enabled || !this.settings.sfxEnabled || this.settings.masterMuted) {
      return null;
    }
    const path = options[Math.floor(Math.random() * options.length)];
    const audio = new Audio(path);
    audio.volume = this.settings.sfxVolume;
    audio.play().catch(warnUnlessAborted);
    return audio;
  }

  public playWithSillyChance(normal: readonly string[], silly: readonly string[]) {
    if (this.settings.sillyMode && silly.length > 0 && Math.random() < 0.5) {
      this.playRandom(silly);
    } else {
      this.playRandom(normal);
    }
  }
}
