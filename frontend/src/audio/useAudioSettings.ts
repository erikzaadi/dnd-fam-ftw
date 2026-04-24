import { useState, useEffect, useCallback } from 'react';
import type { AudioSettings } from './audioTypes';
import { audioManager } from './audioManager';
import { browserTtsService } from '../tts/browserTtsService';

const STORAGE_KEY = 'dnd-audio-settings';

const DEFAULT_SETTINGS: AudioSettings = {
  enabled: true,
  musicEnabled: true,
  sfxEnabled: true,
  masterMuted: false,
  musicVolume: 0.35,
  sfxVolume: 0.6,
  sillyMode: false,
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

  const setEnabled = useCallback((value: boolean) => {
    updateSetting('enabled', value);
    audioManager.updateSettings({ ...settings, enabled: value });
    if (!value) {
      browserTtsService.stop();
    }
  }, [updateSetting, settings]);

  const setMasterMuted = useCallback((value: boolean) => {
    updateSetting('masterMuted', value);
    audioManager.updateSettings({ ...settings, masterMuted: value });
    if (value) {
      browserTtsService.stop();
    }
  }, [updateSetting, settings]);

  const setMusicEnabled = useCallback((value: boolean) => {
    updateSetting('musicEnabled', value);
    if (value && !audioManager.isUnlocked) {
      audioManager.unlock();
    }
    audioManager.updateSettings({ ...settings, musicEnabled: value });
  }, [updateSetting, settings]);

  const setMusicVolume = useCallback((value: number) => {
    updateSetting('musicVolume', value);
    audioManager.updateSettings({ ...settings, musicVolume: value });
  }, [updateSetting, settings]);

  const setSfxEnabled = useCallback((value: boolean) => {
    updateSetting('sfxEnabled', value);
    audioManager.updateSettings({ ...settings, sfxEnabled: value });
  }, [updateSetting, settings]);

  const setSfxVolume = useCallback((value: number) => {
    updateSetting('sfxVolume', value);
    audioManager.updateSettings({ ...settings, sfxVolume: value });
  }, [updateSetting, settings]);

  const setSillyMode = useCallback((value: boolean) => {
    updateSetting('sillyMode', value);
    audioManager.updateSettings({ ...settings, sillyMode: value });
  }, [updateSetting, settings]);

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
