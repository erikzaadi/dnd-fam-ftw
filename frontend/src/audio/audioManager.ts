import { musicPlayer } from './musicPlayer';
import { SfxPlayer } from './sfxPlayer';
import type { AudioSettings, SfxEvent } from './audioTypes';
import { audioCatalog } from './audioCatalog';

export class AudioManager {
  private settings: AudioSettings;
  private sfxPlayer: SfxPlayer;
  private unlocked = false;
  private pendingPlayback = false;

  constructor() {
    const stored = localStorage.getItem('dnd-audio-settings');
    this.settings = stored ? JSON.parse(stored) : {
      enabled: true,
      musicEnabled: true,
      sfxEnabled: true,
      masterMuted: false,
      musicVolume: 0.35,
      sfxVolume: 0.6,
    };
    this.sfxPlayer = new SfxPlayer(this.settings);
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
    this.sfxPlayer.updateSettings(settings);

    musicPlayer.setVolume(settings.musicVolume);
    musicPlayer.setMuted(settings.masterMuted);
    
    if (this.settings.musicEnabled) {
      this.startAmbientMusic();
    } else {
      musicPlayer.stop();
    }
  }

  private lastTension: 'low' | 'medium' | 'high' | null = null;

  public setTension(level: 'low' | 'medium' | 'high') {
    if (this.lastTension === level) {
      return;
    }
    
    this.lastTension = level;

    if (level === 'high') {
      this.startDangerMusic();
    } else {
      this.startAmbientMusic();
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

  public playSfx(event: SfxEvent) {
    if (event === 'dice-roll') {
      this.sfxPlayer.playRandom(audioCatalog.sfx.diceRoll);
    } else if (event === 'success-roll') {
      this.sfxPlayer.playRandom(audioCatalog.sfx.successRoll);
    } else if (event === 'failed-roll') {
      this.sfxPlayer.playRandom(audioCatalog.sfx.failedRoll);
    } else if (event === 'roll-20') {
      this.sfxPlayer.playRandom(audioCatalog.sfx.roll20);
    }
  }

  public startNarrating() {
    if (!this.settings?.sfxEnabled || this.settings.masterMuted) {
      return;
    }
    musicPlayer.setVolume(this.settings.musicVolume * 0.5);
    this.sfxPlayer.playRandom(audioCatalog.sfx.narrating);
  }

  public stopNarrating() {
    musicPlayer.setVolume(this.settings.musicVolume);
  }
}

export const audioManager = new AudioManager();
