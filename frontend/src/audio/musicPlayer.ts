import { audioCatalog } from './audioCatalog';
import type { MusicCategory, MusicPlayer } from './audioTypes';

const CROSSFADE_DURATION = 2000;

export class WebMusicPlayer implements MusicPlayer {
  private channels: [HTMLAudioElement, HTMLAudioElement];
  private activeChannelIndex = 0;
  private currentCategory: MusicCategory | null = null;
  private currentTrack: string | null = null;
  private volume = 1;
  private muted = false;
  private fadeInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.channels = [new Audio(), new Audio()];
    this.channels.forEach(audio => {
      audio.loop = false;
      audio.onended = () => this.playNext();
    });
  }

  public setVolume(volume: number) {
    this.volume = volume;
    this.channels.forEach(audio => {
      audio.volume = this.getEffectiveVolume();
    });
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    // We update volume because getEffectiveVolume() depends on muted state
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

  public stop() {
    this.currentCategory = null;
    this.currentTrack = null;
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

    const steps = 20;
    const stepDuration = CROSSFADE_DURATION / steps;
    let currentStep = 0;

    const startVolume = outgoing.paused ? 0 : outgoing.volume;
    const targetVolume = this.getEffectiveVolume();

    this.fadeInterval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;

      outgoing.volume = Math.max(0, startVolume * (1 - progress));
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
