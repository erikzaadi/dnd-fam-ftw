import { useState, useEffect } from 'react';
import type { BrowserVoiceInfo } from './ttsTypes';
import { browserTtsService } from './browserTtsService';

function loadVoices(): BrowserVoiceInfo[] {
  return browserTtsService.getAvailableVoices();
}

export function useAvailableVoices(): BrowserVoiceInfo[] {
  const [voices, setVoices] = useState<BrowserVoiceInfo[]>(() => loadVoices());

  useEffect(() => {
    if (!browserTtsService.isSupported()) {
      return;
    }

    // Voices may not be available synchronously on first render in some browsers.
    // The voiceschanged event fires when they become available.
    const handleVoicesChanged = () => {
      setVoices(loadVoices());
    };

    window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
    };
  }, []);

  return voices;
}
