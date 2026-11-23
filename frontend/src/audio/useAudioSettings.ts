import { useCallback, useSyncExternalStore } from 'react';
import type { AudioSettings } from './audioTypes';
import { audioManager } from './audioManager';
import { narrationTtsService } from '../tts/narrationTtsService';

const STORAGE_KEY = 'dnd-audio-settings';

// Sound is opt-in: `enabled` stays false until the player taps the sound chip (or a toggle).
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  enabled: false,
  musicEnabled: true,
  sfxEnabled: true,
  masterMuted: false,
  musicVolume: 0.35,
  sfxVolume: 0.6,
  sillyMode: false,
};

export function loadAudioSettings(): AudioSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_AUDIO_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to parse audio settings', e);
  }
  return DEFAULT_AUDIO_SETTINGS;
}

// One store for every component, so the sound chip, the gear menu and Settings never disagree.
let current: AudioSettings = loadAudioSettings();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => current;

function write<K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) {
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (e) {
    console.warn('Failed to save audio settings', e);
  }
  audioManager.updateSettings(current);
  listeners.forEach(listener => listener());
}

export function useAudioSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot);

  const setEnabled = useCallback((value: boolean) => {
    write('enabled', value);
    if (!value) {
      narrationTtsService.stopNarration();
    }
  }, []);

  const setMasterMuted = useCallback((value: boolean) => {
    write('masterMuted', value);
    if (value) {
      narrationTtsService.stopNarration();
    }
  }, []);

  const setMusicEnabled = useCallback((value: boolean) => {
    if (value && !audioManager.isUnlocked) {
      audioManager.unlock();
    }
    write('musicEnabled', value);
  }, []);

  const setMusicVolume = useCallback((value: number) => write('musicVolume', value), []);
  const setSfxEnabled = useCallback((value: boolean) => write('sfxEnabled', value), []);
  const setSfxVolume = useCallback((value: number) => write('sfxVolume', value), []);
  const setSillyMode = useCallback((value: boolean) => write('sillyMode', value), []);

  return {
    settings,
    setEnabled,
    setMusicEnabled,
    setSfxEnabled,
    setMasterMuted,
    setMusicVolume,
    setSfxVolume,
    setSillyMode,
  };
}
