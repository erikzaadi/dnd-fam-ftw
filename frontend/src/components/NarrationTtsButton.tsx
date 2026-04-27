import { useEffect, useRef, useState } from 'react';
import { narrationTtsService } from '../tts/narrationTtsService';
import type { TtsSettings } from '../tts/ttsTypes';

interface NarrationTtsButtonProps {
  text: string;
  ttsSettings: TtsSettings;
  hasTts: boolean;
  turnId?: number | string;
  className?: string;
}

export const NarrationTtsButton = ({
  text,
  ttsSettings,
  hasTts,
  turnId,
  className = '',
}: NarrationTtsButtonProps) => {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const active = narrationTtsService.isNarrationAvailable(ttsSettings, hasTts, true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    const interval = setInterval(() => {
      setPlaying(prev => {
        const speaking = narrationTtsService.isNarrationSpeaking();
        return prev === speaking ? prev : speaking;
      });
    }, 200);
    return () => clearInterval(interval);
  }, [active]);

  if (!active) {
    return null;
  }

  const speak = async () => {
    setLoading(true);
    try {
      await narrationTtsService.speakNarration({
        text,
        settings: ttsSettings,
        hasTts,
        turnId,
        mainNarration: true,
      });
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setPlaying(narrationTtsService.isNarrationSpeaking());
      }
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {!playing && (
        <button
          disabled={loading}
          onClick={speak}
          className="text-xl text-slate-500 hover:text-amber-400 transition-colors leading-none disabled:opacity-50 disabled:cursor-wait"
          aria-label={loading ? 'Generating narration' : 'Replay narration'}
        >
          {loading ? '…' : '🔁'}
        </button>
      )}
      {playing && (
        <button
          onClick={() => narrationTtsService.stopNarration()}
          className="text-xl text-slate-500 hover:text-rose-400 transition-colors leading-none"
          aria-label="Stop narration"
        >
          ⏹
        </button>
      )}
    </div>
  );
};
