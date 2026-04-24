import { useEffect, useRef, useState } from 'react';
import { browserTtsService } from '../tts/browserTtsService';
import type { TtsSettings } from '../tts/ttsTypes';

interface TtsButtonProps {
  text: string;
  ttsSettings: TtsSettings;
  /** Extra class names applied to the wrapper div */
  className?: string;
}

/**
 * Replay / Stop buttons for a piece of text.
 * Shows 🔁 when idle, ⏹ while speaking.
 * Renders nothing if TTS is not enabled/supported.
 */
export const TtsButton = ({ text, ttsSettings, className = '' }: TtsButtonProps) => {
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const active = ttsSettings.enabled && browserTtsService.isSupported();

  useEffect(() => {
    if (!active) {
      return;
    }
    intervalRef.current = setInterval(() => {
      setPlaying(prev => {
        const speaking = browserTtsService.isSpeaking();
        return prev === speaking ? prev : speaking;
      });
    }, 200);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [active]);

  if (!active) {
    return null;
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {!playing && (
        <button
          onClick={() => browserTtsService.speakNarration(text, ttsSettings)}
          className="text-xl text-slate-500 hover:text-amber-400 transition-colors leading-none"
          aria-label="Replay narration"
        >
          🔁
        </button>
      )}
      {playing && (
        <button
          onClick={() => browserTtsService.stop()}
          className="text-xl text-slate-500 hover:text-rose-400 transition-colors leading-none"
          aria-label="Stop narration"
        >
          ⏹
        </button>
      )}
    </div>
  );
};
