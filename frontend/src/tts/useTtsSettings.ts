import { useState, useEffect, useCallback } from 'react';
import type { TtsSettings } from './ttsTypes';
import { OPENAI_TTS_DEFAULT_VOICE } from './ttsTypes';
import { browserTtsService } from './browserTtsService';

const STORAGE_KEY = 'dnd-tts-settings';

const DEFAULT_SETTINGS: TtsSettings = {
  enabled: false,
  autoSpeakNarration: true,
  provider: 'browser',
  volume: 1.0,
  rate: 1.0,
  pitch: 1.0,
  preferredVoiceURI: null,
  preferredVoiceName: null,
  preferredLang: null,
  preferredStyle: 'neutral',
  browserGenderHint: 'any',
  openAiVoice: OPENAI_TTS_DEFAULT_VOICE,
};

export function useTtsSettings() {
  const [settings, setSettings] = useState<TtsSettings>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Migrate: rename preferredGenderHint -> browserGenderHint
        if (parsed.preferredGenderHint !== undefined && parsed.browserGenderHint === undefined) {
          parsed.browserGenderHint = parsed.preferredGenderHint;
          delete parsed.preferredGenderHint;
        }
        return { ...DEFAULT_SETTINGS, ...parsed };
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

  const setProvider = useCallback((value: TtsSettings['provider']) => {
    setSettings(prev => ({ ...prev, provider: value }));
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

  const setBrowserGenderHint = useCallback((value: TtsSettings['browserGenderHint']) => {
    setSettings(prev => ({ ...prev, browserGenderHint: value }));
  }, []);

  const setOpenAiVoice = useCallback((value: TtsSettings['openAiVoice']) => {
    setSettings(prev => ({ ...prev, openAiVoice: value }));
  }, []);

  return {
    settings,
    setEnabled,
    setAutoSpeakNarration,
    setProvider,
    setVolume,
    setRate,
    setPitch,
    setPreferredVoice,
    setPreferredStyle,
    setBrowserGenderHint,
    setOpenAiVoice,
  };
}
