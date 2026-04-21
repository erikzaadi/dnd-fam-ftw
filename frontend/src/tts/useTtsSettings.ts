import { useState, useEffect, useCallback } from 'react';
import type { TtsSettings } from './ttsTypes';
import { browserTtsService } from './browserTtsService';

const STORAGE_KEY = 'dnd-tts-settings';

const DEFAULT_SETTINGS: TtsSettings = {
  enabled: false,
  autoSpeakNarration: true,
  volume: 1.0,
  rate: 1.0,
  pitch: 1.0,
  preferredVoiceURI: null,
  preferredVoiceName: null,
  preferredLang: null,
  preferredStyle: 'neutral',
  preferredGenderHint: 'any',
};

export function useTtsSettings() {
  const [settings, setSettings] = useState<TtsSettings>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      } catch (e) {
        console.error('Failed to parse TTS settings', e);
      }
    }
    return DEFAULT_SETTINGS;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const setEnabled = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, enabled: value }));
    if (!value) {
      browserTtsService.stop();
    }
  }, []);

  const setAutoSpeakNarration = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, autoSpeakNarration: value }));
  }, []);

  const setVolume = useCallback((value: number) => {
    setSettings(prev => ({ ...prev, volume: value }));
  }, []);

  const setRate = useCallback((value: number) => {
    setSettings(prev => ({ ...prev, rate: value }));
  }, []);

  const setPitch = useCallback((value: number) => {
    setSettings(prev => ({ ...prev, pitch: value }));
  }, []);

  const setPreferredVoice = useCallback((voiceURI: string | null, voiceName: string | null, lang: string | null) => {
    setSettings(prev => ({ ...prev, preferredVoiceURI: voiceURI, preferredVoiceName: voiceName, preferredLang: lang }));
  }, []);

  const setPreferredStyle = useCallback((value: TtsSettings['preferredStyle']) => {
    setSettings(prev => ({ ...prev, preferredStyle: value }));
  }, []);

  const setPreferredGenderHint = useCallback((value: TtsSettings['preferredGenderHint']) => {
    setSettings(prev => ({ ...prev, preferredGenderHint: value }));
  }, []);

  return {
    settings,
    setEnabled,
    setAutoSpeakNarration,
    setVolume,
    setRate,
    setPitch,
    setPreferredVoice,
    setPreferredStyle,
    setPreferredGenderHint,
  };
}
