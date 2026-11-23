import { useEffect, useState } from 'react';
import { audioManager } from './audioManager';
import { useAudioSettings } from './useAudioSettings';

// Whether this page load still needs the player's sound opt-in, and the tap handler that gives it.
export function useSoundOptIn() {
  const { settings, setEnabled } = useAudioSettings();
  const [unlocked, setUnlocked] = useState(audioManager.isUnlocked);

  useEffect(() => {
    const onUnlocked = () => setUnlocked(true);
    document.addEventListener('audio-unlocked', onUnlocked);
    return () => document.removeEventListener('audio-unlocked', onUnlocked);
  }, []);

  const enable = () => {
    // Unlock synchronously inside the tap so Safari keeps the gesture.
    audioManager.unlock();
    if (!settings.enabled) {
      setEnabled(true);
    }
  };

  return {
    needed: !(unlocked && settings.enabled),
    icon: settings.enabled ? '🔊' : '🔇',
    label: settings.enabled ? 'Tap to resume sound' : 'Sound off: tap to enable',
    enable,
  };
}
