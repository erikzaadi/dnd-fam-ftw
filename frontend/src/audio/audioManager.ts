import { musicPlayer } from './musicPlayer';
import type { AudioSettings, SfxEvent } from './audioTypes';

export class AudioManager {
  private settings: AudioSettings;
  private unlocked = false;
  private pendingPlayback = false;

  constructor() {
    const stored = localStorage.getItem('dnd-audio-settings');
    this.settings = stored ? JSON.parse(stored) : {
      musicEnabled: false,
      sfxEnabled: false,
      masterMuted: false,
      musicVolume: 0.35,
      sfxVolume: 0.6,
    };
  }

  public get isUnlocked() {
    return this.unlocked;
  }

  public async unlock() {
    if (this.unlocked) {
      return;
    }
    
    const silent = new Audio();
    silent.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
    try {
      await silent.play();
      this.unlocked = true;
      if (this.pendingPlayback && this.settings.musicEnabled) {
        this.pendingPlayback = false;
        await this.startAmbientMusic();
      }
    } catch (e) {
      console.warn('[AudioManager] Unlock failed', e);
    }
  }

  public updateSettings(settings: AudioSettings) {
    this.settings = settings;

    musicPlayer.setVolume(settings.musicVolume);
    musicPlayer.setMuted(settings.masterMuted);
    
    if (this.settings.musicEnabled) {
      this.startAmbientMusic();
    } else {
      musicPlayer.stop();
    }
  }

  public async startAmbientMusic() {
    const stored = localStorage.getItem('dnd-audio-settings');
    const settings = stored ? JSON.parse(stored) : this.settings;
    
    if (!settings.musicEnabled) {
      return;
    }
    if (!this.unlocked) {
      this.pendingPlayback = true;
      return;
    }
    await musicPlayer.start('ambient');
  }

  public async startDangerMusic() {
    if (!this.settings?.musicEnabled) {
      return;
    }
    await musicPlayer.start('danger');
  }

  public async skipTrack() {
    await musicPlayer.skipTrack();
  }

  public stopMusic() {
    musicPlayer.stop();
  }

  // SFX Placeholders for Phase 3
  public playSfx(_event: SfxEvent) {
    if (!this.settings?.sfxEnabled || this.settings.masterMuted) {
      return;
    }
  }

  public startNarrating() {
    if (!this.settings?.sfxEnabled || this.settings.masterMuted) {
      return;
    }
  }

  public stopNarrating() {
  }
}

export const audioManager = new AudioManager();
