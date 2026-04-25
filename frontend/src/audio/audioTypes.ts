export type AudioSettings = {
  enabled: boolean;
  musicEnabled: boolean;
  sfxEnabled: boolean;
  masterMuted: boolean;
  musicVolume: number; // 0..1
  sfxVolume: number;   // 0..1
  sillyMode: boolean;
};

export type MusicCategory = 'ambient' | 'danger';

export type SfxEvent =
  | 'dice-roll'
  | 'success-roll'
  | 'failed-roll'
  | 'roll-20'
  | 'narrating';

export interface MusicPlayer {
  start(category: MusicCategory): Promise<void>;
  startNext(category: MusicCategory): Promise<void>;
  stop(): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
}
