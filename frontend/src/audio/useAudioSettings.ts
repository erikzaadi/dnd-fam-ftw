import { useState, useEffect, useCallback } from 'react';
import type { AudioSettings } from './audioTypes';
import { audioManager } from './audioManager';

const STORAGE_KEY = 'dnd-audio-settings';

const DEFAULT_SETTINGS: AudioSettings = {
  musicEnabled: false,
  sfxEnabled: false,
  masterMuted: false,
  musicVolume: 0.35,
  sfxVolume: 0.6,
};

export function useAudioSettings() {
  const [settings, setSettings] = useState<AudioSettings>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      } catch (e) {
        console.error('Failed to parse audio settings', e);
      }
    }
    return DEFAULT_SETTINGS;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const updateSetting = useCallback(<K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const setMusicEnabled = useCallback((value: boolean) => {
    updateSetting('musicEnabled', value);
    if (value && !audioManager.isUnlocked) {
      audioManager.unlock();
    }
  }, [updateSetting]);

  const setMasterMuted = useCallback((value: boolean) => {
    updateSetting('masterMuted', value);
    // Directly notify the manager
    audioManager.updateSettings({ ...settings, masterMuted: value });
  }, [updateSetting, settings]);

  const setMusicVolume = useCallback((value: number) => {
    updateSetting('musicVolume', value);
    audioManager.updateSettings({ ...settings, musicVolume: value });
  }, [updateSetting, settings]);

  return {
    settings,
    setMusicEnabled,
    setSfxEnabled: (v: boolean) => updateSetting('sfxEnabled', v),
    setMasterMuted,
    setMusicVolume,
    setSfxVolume: (v: number) => updateSetting('sfxVolume', v),
  };
}
