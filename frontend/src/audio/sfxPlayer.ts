import type { AudioSettings } from './audioTypes';

export class SfxPlayer {
  private settings: AudioSettings;

  constructor(settings: AudioSettings) {
    this.settings = settings;
  }

  public updateSettings(settings: AudioSettings) {
    this.settings = settings;
  }

  public play(path: string) {
    if (!this.settings.sfxEnabled || this.settings.masterMuted) {
      return;
    }
    const audio = new Audio(path);
    audio.volume = this.settings.sfxVolume;
    audio.play().catch(e => console.warn('[SfxPlayer] Playback failed', e));
  }

  public playRandom(options: readonly string[]) {
    if (options.length === 0) {
      return;
    }
    const path = options[Math.floor(Math.random() * options.length)];
    this.play(path);
  }
}
