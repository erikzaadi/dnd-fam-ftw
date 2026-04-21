import { useState, useEffect } from 'react';
import { audioManager } from '../audio/audioManager';
import { useAudioSettings } from '../audio/useAudioSettings';

export const AudioUnlockOverlay = () => {
  const [show, setShow] = useState(false);
  const { settings } = useAudioSettings();

  useEffect(() => {
    const isLocked = !(audioManager as unknown as { isUnlocked: boolean }).isUnlocked;
    if (isLocked && settings.musicEnabled) {
      setTimeout(() => setShow(true), 0);
    }
  }, [settings.musicEnabled]);

  if (!show) {
    return null;
  }

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in"
      onClick={async () => {
        await audioManager.unlock();
        setShow(false);
      }}
    >
      <div className="bg-slate-900 border-2 border-amber-500/50 p-8 rounded-3xl max-w-sm text-center space-y-4">
        <div className="text-4xl">🔊</div>
        <h2 className="text-xl font-black uppercase tracking-widest text-white">Audio Locked</h2>
        <p className="text-slate-400 text-sm">Tap anywhere to enable game sound and music.</p>
        <button className="px-6 py-3 bg-amber-600 rounded-xl font-black text-white w-full">Enable Audio</button>
      </div>
    </div>
  );
};
