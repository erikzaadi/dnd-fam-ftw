import type { TurnResult } from '../../types';
import { imgSrc } from '../../lib/api';
import type { TtsSettings } from '../../tts/ttsTypes';
import { NarrationTtsButton } from '../NarrationTtsButton';
import { SceneBackground } from './SceneBackground';
import { useCallback, useEffect, useRef, useState } from 'react';

const TENSION_CONFIG = {
  low: { label: 'Calm', color: 'text-emerald-400', bg: 'bg-emerald-900/40', border: 'border-emerald-700/40', icon: '🌿' },
  medium: { label: 'Tense', color: 'text-amber-400', bg: 'bg-amber-900/40', border: 'border-amber-700/40', icon: '⚡' },
  high: { label: 'Danger', color: 'text-rose-400', bg: 'bg-rose-900/40', border: 'border-rose-700/40', icon: '🔥' },
};

interface StoryStageProps {
  history: TurnResult[];
  viewedTurnIdx: number;
  imageLoading: boolean;
  ttsSettings: TtsSettings;
  hasTts: boolean;
  chronicleOpen: boolean;
  currentTensionLevel?: 'low' | 'medium' | 'high' | null;
  focusRequest: number;
  onOpenChronicle: () => void;
  onFullscreenImage: (url: string) => void;
  onFullscreenNarration: (narration: string) => void;
}

export const StoryStage = ({
  history,
  viewedTurnIdx,
  imageLoading,
  ttsSettings,
  hasTts,
  chronicleOpen,
  currentTensionLevel,
  focusRequest,
  onOpenChronicle,
  onFullscreenImage,
  onFullscreenNarration,
}: StoryStageProps) => {
  const narrationTextRef = useRef<HTMLParagraphElement | null>(null);
  const [isNarrationScrollable, setIsNarrationScrollable] = useState(false);

  const displayTurn = history[viewedTurnIdx] ?? null;
  const previousTurn = viewedTurnIdx > 0 ? history[viewedTurnIdx - 1] : null;
  const isCurrentTurn = viewedTurnIdx === history.length - 1;

  const imageUrl = displayTurn?.imageUrl ? imgSrc(displayTurn.imageUrl) : null;
  const defaultImageUrl = imgSrc('/images/default_scene.png');
  const narration = displayTurn?.narration ?? '';

  const updateNarrationScrollability = useCallback(() => {
    const narrationText = narrationTextRef.current;
    if (!narrationText) {
      setIsNarrationScrollable(false);
      return;
    }

    setIsNarrationScrollable(narrationText.scrollHeight > narrationText.clientHeight + 4);
  }, []);

  const handleStageClick = () => {
    if (imageUrl) {
      onFullscreenImage(imageUrl);
    } else if (!imageLoading) {
      onFullscreenImage(defaultImageUrl);
    }
  };

  useEffect(() => {
    if (focusRequest <= 0 || !narration) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const narrationText = narrationTextRef.current;
      if (!narrationText) {
        return;
      }

      narrationText.focus({ preventScroll: true });
      narrationText.scrollTo({ top: 0, behavior: 'smooth' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest, narration]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateNarrationScrollability);

    const narrationText = narrationTextRef.current;
    if (!narrationText) {
      return () => window.cancelAnimationFrame(frame);
    }

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateNarrationScrollability);
      return () => {
        window.cancelAnimationFrame(frame);
        window.removeEventListener('resize', updateNarrationScrollability);
      };
    }

    const resizeObserver = new ResizeObserver(updateNarrationScrollability);
    resizeObserver.observe(narrationText);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [narration, updateNarrationScrollability]);

  return (
    <div
      className="relative flex flex-col h-full min-h-0 overflow-hidden rounded-[32px] bg-slate-950 cursor-zoom-in"
      onClick={handleStageClick}
    >
      <SceneBackground imageUrl={imageUrl} defaultImageUrl={defaultImageUrl} />

      {/* Painting the scene badge - top-left when loading */}
      {imageLoading && (
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 border border-slate-700 rounded-full backdrop-blur-sm">
          <div className="w-3 h-3 border-2 border-slate-600 border-t-amber-500 rounded-full animate-spin shrink-0" />
          <span className="text-xs font-black uppercase tracking-widest text-slate-400">Painting the scene...</span>
        </div>
      )}

      {/* Top-right badges: viewing old turn + tension */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        {currentTensionLevel && currentTensionLevel !== 'low' && isCurrentTurn && (() => {
          const t = TENSION_CONFIG[currentTensionLevel];
          return (
            <div className={`flex items-center gap-1 px-2.5 py-1 ${t.bg} border ${t.border} rounded-full backdrop-blur-sm`}>
              <span className="text-[10px]">{t.icon}</span>
              <span className={`text-xs font-black uppercase tracking-widest ${t.color}`}>{t.label}</span>
            </div>
          );
        })()}
        {!isCurrentTurn && (
          <div className="px-3 py-1 bg-slate-900/80 border border-slate-700 rounded-full text-xs font-black uppercase tracking-widest text-slate-400 backdrop-blur-sm">
            Turn {viewedTurnIdx + 1}
          </div>
        )}
      </div>

      {/* Narration card - centered, fills ~75% of stage */}
      <div className="relative z-10 flex-1 min-h-0 flex items-center justify-center p-4 pb-16">
        {narration ? (
          <div
            aria-label="Story narration"
            className="backdrop-blur-md bg-slate-950/55 rounded-[24px] p-8 lg:p-12 w-[78%] max-h-[75%] min-h-0 flex flex-col items-start justify-start cursor-pointer hover:bg-slate-950/65 transition-colors overflow-hidden"
            onClick={e => {
              e.stopPropagation();
              onFullscreenNarration(narration);
            }}
          >
            <p
              ref={narrationTextRef}
              tabIndex={-1}
              className={`font-narrative text-slate-100 italic text-center w-full flex-1 min-h-0 text-sm sm:text-base md:text-lg lg:text-3xl xl:text-4xl 2xl:text-5xl 3xl:text-6xl 4xl:text-7xl ultrawide:text-7xl leading-relaxed ${isNarrationScrollable ? 'overflow-y-auto scrollbar-hide' : 'overflow-y-hidden'} overscroll-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70`}
            >
              {narration}
            </p>
            <div className="mt-6 shrink-0" onClick={e => e.stopPropagation()}>
              <NarrationTtsButton
                text={narration}
                ttsSettings={ttsSettings}
                hasTts={hasTts}
                turnId={displayTurn?.id}
                className="justify-center"
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Previous turn teaser + Chronicle link - fades out when chronicle is open */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-3 gap-4 bg-slate-950/80 backdrop-blur-sm transition-opacity duration-300 ${chronicleOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        onClick={e => e.stopPropagation()}
      >
        {previousTurn ? (
          <p className="text-xs text-slate-500 italic truncate flex-1 min-w-0">
            {previousTurn.narration.slice(0, 80)}{previousTurn.narration.length > 80 ? '...' : ''}
          </p>
        ) : (
          <span />
        )}
        <button
          onClick={onOpenChronicle}
          className="inline-flex items-center gap-1.5 text-sm font-black uppercase tracking-widest text-amber-600 hover:text-amber-400 transition-colors shrink-0 whitespace-nowrap"
        >
          <img src={imgSrc('/images/icon_scroll.png')} alt="" className="w-4 h-4 object-contain mix-blend-screen" />
          Open Chronicle →
        </button>
      </div>
    </div>
  );
};
