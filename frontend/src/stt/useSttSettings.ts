import { useCallback, useEffect, useState } from 'react';

export type SttSettings = {
  enabled: boolean;
};

const STORAGE_KEY = 'dnd-stt-settings';

const DEFAULT_SETTINGS: SttSettings = {
  enabled: false,
};

export function useSttSettings() {
  const [settings, setSettings] = useState<SttSettings>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      } catch {
        return DEFAULT_SETTINGS;
      }
    }
    return DEFAULT_SETTINGS;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const setEnabled = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, enabled: value }));
  }, []);

  return {
    settings,
    setEnabled,
  };
}
