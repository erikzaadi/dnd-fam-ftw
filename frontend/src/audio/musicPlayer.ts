import { audioCatalog } from 'virtual:audio-catalog';
import type { MusicCategory, MusicPlayer } from './audioTypes';

const CROSSFADE_DURATION = 5000;

export class WebMusicPlayer implements MusicPlayer {
  private channels: [HTMLAudioElement, HTMLAudioElement];
  private activeChannelIndex = 0;
  private currentCategory: MusicCategory | null = null;
  private currentTrack: string | null = null;
  private currentTrackPlayCount = 0;
  private volume = 1;
  private muted = false;
  private fadeInterval: ReturnType<typeof setInterval> | null = null;
  private volumeRampInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.channels = [new Audio(), new Audio()];
    this.channels.forEach((audio, index) => {
      audio.loop = false;
      audio.onended = () => {
        if (index !== this.activeChannelIndex) {
          return;
        }

        if (this.currentTrackPlayCount < 2) {
          this.currentTrackPlayCount++;
          audio.currentTime = 0;
          audio.play().catch(e => {
            if (e instanceof Error && e.name !== 'AbortError') {
              console.warn('Music loop failed', e);
            }
          });
        } else {
          this.playNext();
        }
      };
    });
  }

  public setVolume(volume: number) {
    this.cancelVolumeRamp();
    this.volume = volume;
    if (this.fadeInterval) {
      // A crossfade is running: its ticks read the new volume live. Writing
      // channels directly here would blast both the outgoing and incoming
      // tracks to full volume for a tick - an audible burst.
      return;
    }
    this.channels.forEach(audio => {
      audio.volume = this.getEffectiveVolume();
    });
  }

  // Smoothly ramp toward a new volume (e.g. ducking under narration sfx).
  public fadeVolumeTo(volume: number, durationMs = 350) {
    this.cancelVolumeRamp();
    this.volume = volume;
    if (this.fadeInterval) {
      return; // crossfade ticks pick up the new target each step
    }
    const active = this.channels[this.activeChannelIndex];
    const target = this.getEffectiveVolume();
    if (this.muted || active.paused) {
      this.channels.forEach(audio => {
        audio.volume = target;
      });
      return;
    }
    const startVolume = active.volume;
    const steps = Math.max(1, Math.round(durationMs / 25));
    let currentStep = 0;
    this.volumeRampInterval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;
      active.volume = startVolume + (target - startVolume) * progress;
      if (currentStep >= steps) {
        this.cancelVolumeRamp();
        active.volume = target;
      }
    }, 25);
  }

  private cancelVolumeRamp() {
    if (this.volumeRampInterval) {
      clearInterval(this.volumeRampInterval);
      this.volumeRampInterval = null;
    }
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (this.fadeInterval) {
      return; // crossfade ticks read the muted state live
    }
    this.channels.forEach(audio => {
      audio.volume = this.getEffectiveVolume();
    });
  }

  private getEffectiveVolume() {
    return this.muted ? 0 : this.volume;
  }

  public async start(category: MusicCategory): Promise<void> {
    if (this.currentCategory === category && this.currentTrack && !this.channels[this.activeChannelIndex].paused) {
      return;
    }

    this.currentCategory = category;
    await this.playNext(true);
  }

  public async skipTrack(): Promise<void> {
    await this.playNext(true);
  }

  public async startNext(category: MusicCategory): Promise<void> {
    this.currentCategory = category;
    await this.playNext(true);
  }

  public stop() {
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }
    this.cancelVolumeRamp();
    this.currentCategory = null;
    this.currentTrack = null;
    this.currentTrackPlayCount = 0;
    this.channels.forEach(audio => {
      audio.pause();
      audio.src = '';
    });
  }

  private async playNext(_forceFade = false) {
    if (!this.currentCategory) {
      return;
    }

    const tracks = audioCatalog.music[this.currentCategory] as readonly string[];
    if (tracks.length === 0) {
      return;
    }

    let nextTrack = tracks[Math.floor(Math.random() * tracks.length)];
    if (tracks.length > 1 && nextTrack === this.currentTrack) {
      nextTrack = tracks.find(t => t !== this.currentTrack) || nextTrack;
    }

    this.currentTrack = nextTrack;
    this.currentTrackPlayCount = 1;
    const incomingIndex = 1 - this.activeChannelIndex;
    const outgoing = this.channels[this.activeChannelIndex];
    const incoming = this.channels[incomingIndex];

    incoming.src = nextTrack;
    incoming.volume = 0;
    incoming.muted = this.muted;

    try {
      await incoming.play();
      this.crossfade(outgoing, incoming);
      this.activeChannelIndex = incomingIndex;
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        console.warn('Music playback failed', e);
      }
    }
  }

  private crossfade(outgoing: HTMLAudioElement, incoming: HTMLAudioElement) {
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
    }

    const steps = 50;
    const stepDuration = CROSSFADE_DURATION / steps;
    let currentStep = 0;

    const startVolume = outgoing.paused ? 0 : outgoing.volume;

    this.fadeInterval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;

      // Read the target live each tick so ducking/restoring or muting during
      // the 5s crossfade retargets the ramp instead of being clobbered by it.
      const targetVolume = this.getEffectiveVolume();
      outgoing.volume = this.muted ? 0 : Math.max(0, startVolume * (1 - progress));
      incoming.volume = targetVolume * progress;

      if (currentStep >= steps) {
        if (this.fadeInterval) {
          clearInterval(this.fadeInterval);
        }
        this.fadeInterval = null;
        outgoing.pause();
        outgoing.src = '';
        incoming.volume = targetVolume;
      }
    }, stepDuration);
  }
}

export const musicPlayer = new WebMusicPlayer();
