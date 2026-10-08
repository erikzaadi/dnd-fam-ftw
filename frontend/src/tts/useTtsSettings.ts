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
  openAiVoiceChosen: false,
};

// Reads settings saved by any earlier version. Exported for tests.
export function migrateStoredTtsSettings(parsed: Record<string, unknown>): TtsSettings {
  const stored = { ...parsed };
  // Migrate: rename preferredGenderHint -> browserGenderHint
  if (stored.preferredGenderHint !== undefined && stored.browserGenderHint === undefined) {
    stored.browserGenderHint = stored.preferredGenderHint;
    delete stored.preferredGenderHint;
  }
  // The default narrator changed from cedar to ash. Settings saved before the
  // "chosen" flag always carried a voice, so a pick cannot be told from the old
  // default: an unflagged cedar follows the new default, any other voice was a pick.
  if (stored.openAiVoiceChosen === undefined) {
    stored.openAiVoiceChosen = stored.openAiVoice !== undefined && stored.openAiVoice !== 'cedar';
    if (!stored.openAiVoiceChosen) {
      stored.openAiVoice = OPENAI_TTS_DEFAULT_VOICE;
    }
  }
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function useTtsSettings() {
  const [settings, setSettings] = useState<TtsSettings>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return migrateStoredTtsSettings(JSON.parse(stored));
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
    setSettings(prev => ({ ...prev, openAiVoice: value, openAiVoiceChosen: true }));
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
