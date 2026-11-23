import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { audioManager } from '../audio/audioManager';
import { useAudioSettings } from '../audio/useAudioSettings';

// Sign-in and TV pairing pages play no audio, so they get no chip.
const QUIET_PATHS = ['/login', '/verify-email', '/namespace-picker', '/request-invite', '/accept-invite', '/tv', '/link'];

// Opt-in sound: a small chip instead of a blocking prompt. Hidden once sound is on.
export const SoundChip = () => {
  const { pathname } = useLocation();
  const { settings, setEnabled } = useAudioSettings();
  const [unlocked, setUnlocked] = useState(audioManager.isUnlocked);

  useEffect(() => {
    const onUnlocked = () => setUnlocked(true);
    document.addEventListener('audio-unlocked', onUnlocked);
    return () => document.removeEventListener('audio-unlocked', onUnlocked);
  }, []);

  if ((unlocked && settings.enabled) || QUIET_PATHS.includes(pathname)) {
    return null;
  }

  const handleEnable = () => {
    // Unlock synchronously inside the tap so Safari keeps the gesture.
    audioManager.unlock();
    if (!settings.enabled) {
      setEnabled(true);
    }
  };

  return (
    <button
      type="button"
      onClick={handleEnable}
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[85] flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-700 bg-slate-900/90 backdrop-blur-sm text-xs font-black uppercase tracking-widest text-slate-300 hover:border-amber-500/60 hover:text-amber-200 transition-colors"
    >
      <span aria-hidden="true">{settings.enabled ? '🔊' : '🔇'}</span>
      {settings.enabled ? 'Tap to resume sound' : 'Sound off: tap to enable'}
    </button>
  );
};
