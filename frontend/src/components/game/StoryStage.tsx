import { useEffect, useRef, useState } from 'react';
import type { TurnResult } from '../../types';
import { imgSrc } from '../../lib/api';
import { browserTtsService } from '../../tts/browserTtsService';
import type { TtsSettings } from '../../tts/ttsTypes';

interface StoryStageProps {
  history: TurnResult[];
  viewedTurnIdx: number;
  imageLoading: boolean;
  ttsSettings: TtsSettings;
  chronicleOpen: boolean;
  onOpenChronicle: () => void;
  onFullscreenImage: (url: string) => void;
  onFullscreenNarration: (narration: string) => void;
}

export const StoryStage = ({
  history,
  viewedTurnIdx,
  imageLoading,
  ttsSettings,
  chronicleOpen,
  onOpenChronicle,
  onFullscreenImage,
  onFullscreenNarration,
}: StoryStageProps) => {
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const ttsActive = ttsSettings.enabled && browserTtsService.isSupported();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!ttsActive) {
      return;
    }
    intervalRef.current = setInterval(() => {
      setTtsPlaying(prev => {
        const speaking = browserTtsService.isSpeaking();
        return prev === speaking ? prev : speaking;
      });
    }, 200);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [ttsActive]);

  const displayTurn = history[viewedTurnIdx] ?? null;
  const previousTurn = viewedTurnIdx > 0 ? history[viewedTurnIdx - 1] : null;
  const isCurrentTurn = viewedTurnIdx === history.length - 1;

  const imageUrl = displayTurn?.imageUrl ? imgSrc(displayTurn.imageUrl) : null;
  const defaultImageUrl = imgSrc('/images/default_scene.png');
  const narration = displayTurn?.narration ?? '';

  const handleStageClick = () => {
    if (imageUrl) {
      onFullscreenImage(imageUrl);
    } else if (!imageLoading) {
      onFullscreenImage(defaultImageUrl);
    }
  };

  return (
    <div
      className="relative flex flex-col h-full overflow-hidden rounded-[32px] bg-slate-950 cursor-zoom-in"
      onClick={handleStageClick}
    >
      {/* Default image always shown as base */}
      <img
        src={defaultImageUrl}
        className="absolute inset-0 w-full h-full object-cover opacity-20 animate-ken-burns"
        alt=""
      />

      {/* Turn image crossfades in over default when ready */}
      {imageUrl && (
        <img
          key={imageUrl}
          src={imageUrl}
          className="absolute inset-0 w-full h-full object-cover animate-ken-burns animate-in fade-in duration-1000"
          alt=""
        />
      )}

      {/* Painting the scene badge - top-left when loading */}
      {imageLoading && (
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 border border-slate-700 rounded-full backdrop-blur-sm">
          <div className="w-3 h-3 border-2 border-slate-600 border-t-amber-500 rounded-full animate-spin shrink-0" />
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Painting the scene...</span>
        </div>
      )}

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent pointer-events-none" />

      {/* Viewing old turn badge */}
      {!isCurrentTurn && (
        <div className="absolute top-4 right-4 z-10 px-3 py-1 bg-slate-900/80 border border-slate-700 rounded-full text-[9px] font-black uppercase tracking-widest text-slate-400 backdrop-blur-sm">
          Turn {viewedTurnIdx + 1}
        </div>
      )}

      {/* Narration card - centered, fills ~75% of stage */}
      <div className="relative z-10 flex-1 flex items-center justify-center p-4">
        {narration ? (
          <div
            className="backdrop-blur-md bg-slate-950/55 rounded-[24px] p-8 lg:p-12 w-[78%] h-[75%] flex flex-col items-center justify-center cursor-pointer hover:bg-slate-950/65 transition-colors overflow-y-auto scrollbar-hide"
            onClick={e => {
              e.stopPropagation();
              onFullscreenNarration(narration);
            }}
          >
            <p className="font-narrative text-2xl lg:text-3xl xl:text-4xl text-slate-100 leading-relaxed italic text-center main-story-text">
              {narration}
            </p>
            {ttsActive && (
              <div className="flex items-center justify-center gap-4 mt-6" onClick={e => e.stopPropagation()}>
                {!ttsPlaying && (
                  <button
                    onClick={() => browserTtsService.speakNarration(narration, ttsSettings)}
                    className="text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-amber-400 transition-colors"
                  >
                    replay
                  </button>
                )}
                {ttsPlaying && (
                  <button
                    onClick={() => browserTtsService.stop()}
                    className="text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-rose-400 transition-colors"
                  >
                    stop
                  </button>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Previous turn teaser + Chronicle link - fades out when chronicle is open */}
      <div
        className={`relative z-10 flex items-center justify-between px-6 py-3 gap-4 transition-opacity duration-300 ${chronicleOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        onClick={e => e.stopPropagation()}
      >
        {previousTurn ? (
          <p className="text-[11px] text-slate-500 italic truncate flex-1 min-w-0">
            {previousTurn.narration.slice(0, 80)}{previousTurn.narration.length > 80 ? '...' : ''}
          </p>
        ) : (
          <span />
        )}
        <button
          onClick={onOpenChronicle}
          className="text-[10px] font-black uppercase tracking-widest text-amber-600 hover:text-amber-400 transition-colors shrink-0 whitespace-nowrap"
        >
          Open Chronicle →
        </button>
      </div>
    </div>
  );
};
