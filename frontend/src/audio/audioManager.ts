import { musicPlayer } from './musicPlayer';
import { SfxPlayer } from './sfxPlayer';
import type { AudioSettings, SfxEvent } from './audioTypes';
import { audioCatalog } from 'virtual:audio-catalog';

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
      sillyMode: false,
    };
    this.sfxPlayer = new SfxPlayer(this.settings);
  }

  public get isUnlocked() {
    return this.unlocked;
  }

  public unlockOnFirstGesture() {
    if (this.unlocked || this.gestureListenersAdded) {
      return;
    }
    this.gestureListenersAdded = true;
    const handler = () => {
      this.unlock();
    };
    document.addEventListener('click', handler, { once: true });
    document.addEventListener('keydown', handler, { once: true });
    document.addEventListener('touchstart', handler, { once: true });
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
  private narratingAudio: HTMLAudioElement | null = null;
  private gestureListenersAdded = false;

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
    if (!this.settings.musicEnabled) {
      return;
    }
    if (!this.unlocked) {
      this.pendingPlayback = true;
      return;
    }
    await musicPlayer.start('ambient');
  }

  public async startDangerMusic() {
    if (!this.settings?.musicEnabled || !this.unlocked) {
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
    this.stopNarratingAudio();
    const { diceRoll, successRoll, failedRoll, roll20 } = audioCatalog.sfx;
    if (event === 'dice-roll') {
      this.sfxPlayer.playWithSillyChance(diceRoll.normal, diceRoll.silly);
    } else if (event === 'success-roll') {
      this.sfxPlayer.playWithSillyChance(successRoll.normal, successRoll.silly);
    } else if (event === 'failed-roll') {
      this.sfxPlayer.playWithSillyChance(failedRoll.normal, failedRoll.silly);
    } else if (event === 'roll-20') {
      this.sfxPlayer.playWithSillyChance(roll20.normal, roll20.silly);
    }
  }

  public startNarrating() {
    if (!this.settings?.sfxEnabled || this.settings.masterMuted) {
      return;
    }
    musicPlayer.setVolume(this.settings.musicVolume * 0.5);
    this.narratingAudio = this.sfxPlayer.playRandomTracked(audioCatalog.sfx.narrating.normal);
  }

  private stopNarratingAudio() {
    if (this.narratingAudio) {
      this.narratingAudio.pause();
      this.narratingAudio.currentTime = 0;
      this.narratingAudio = null;
    }
  }

  public stopNarrating() {
    this.stopNarratingAudio();
    musicPlayer.setVolume(this.settings.musicVolume);
  }
}

export const audioManager = new AudioManager();
