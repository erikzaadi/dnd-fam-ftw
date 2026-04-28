import { useState, useEffect } from 'react';
import type { BrowserVoiceInfo } from './ttsTypes';
import { browserTtsService } from './browserTtsService';

const VOICE_LOAD_TIMEOUT_MS = 4000;

function loadVoices(): BrowserVoiceInfo[] {
  return browserTtsService.getAvailableVoices();
}

export function useAvailableVoices(): { voices: BrowserVoiceInfo[]; timedOut: boolean } {
  const [voices, setVoices] = useState<BrowserVoiceInfo[]>(() => loadVoices());
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!browserTtsService.isSupported()) {
      return;
    }

    const handleVoicesChanged = () => {
      setVoices(loadVoices());
    };

    window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);

    const timeout = setTimeout(() => {
      setTimedOut(true);
    }, VOICE_LOAD_TIMEOUT_MS);

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
      clearTimeout(timeout);
    };
  }, []);

  return { voices, timedOut };
}
