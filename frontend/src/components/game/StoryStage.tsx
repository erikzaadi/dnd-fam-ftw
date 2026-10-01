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
  currentTensionLevel?: 'low' | 'medium' | 'high' | null;
  focusRequest: number;
  onFullscreenImage: (url: string) => void;
  onFullscreenNarration: (narration: string) => void;
}

export const StoryStage = ({
  history,
  viewedTurnIdx,
  imageLoading,
  ttsSettings,
  hasTts,
  currentTensionLevel,
  focusRequest,
  onFullscreenImage,
  onFullscreenNarration,
}: StoryStageProps) => {
  const narrationTextRef = useRef<HTMLParagraphElement | null>(null);
  const [isNarrationScrollable, setIsNarrationScrollable] = useState(false);
  const [isNarrationAtEnd, setIsNarrationAtEnd] = useState(true);

  const displayTurn = history[viewedTurnIdx] ?? null;
  const isCurrentTurn = viewedTurnIdx === history.length - 1;

  const imageUrl = displayTurn?.imageUrl ? imgSrc(displayTurn.imageUrl) : null;
  const defaultImageUrl = imgSrc('/images/default_scene.png');
  const narration = displayTurn?.narration ?? '';
  const cardClass = 'bg-slate-950/44 sm:bg-slate-950/52 rounded-[20px] sm:rounded-[24px] p-5 sm:p-8 lg:p-12 w-full sm:w-[94%] h-full min-h-0 [container-type:size] flex flex-col items-center justify-center cursor-zoom-in transition-colors overflow-hidden border border-slate-700/25 sm:border-0 shadow-xl sm:shadow-none';
  // Card fills the stage; text scales with the card (cqi/cqh) so it grows with the space instead of per breakpoint.
  const textClass = 'font-narrative text-slate-50 italic text-center text-pretty w-full min-h-0 text-[clamp(1.375rem,min(3.6cqi,6.5cqh),4.5rem)] leading-relaxed [text-shadow:0_2px_8px_rgba(0,0,0,1),0_0_18px_rgba(0,0,0,0.95)]';
  // Hidden scrollbar: fade the bottom edge so overflowing narration reads as scrollable, not cut off.
  const overflowFadeClass = '[mask-image:linear-gradient(to_bottom,black_80%,transparent)]';
  const emptyCardClass = 'backdrop-blur-md bg-slate-950/55 rounded-[24px] p-8 w-[78%] h-[75%] min-h-0 flex items-center justify-center';

  const updateNarrationScrollability = useCallback(() => {
    const narrationText = narrationTextRef.current;
    if (!narrationText) {
      setIsNarrationScrollable(false);
      setIsNarrationAtEnd(true);
      return;
    }

    setIsNarrationScrollable(narrationText.scrollHeight > narrationText.clientHeight + 4);
    setIsNarrationAtEnd(narrationText.scrollTop + narrationText.clientHeight >= narrationText.scrollHeight - 4);
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
      className={`relative flex flex-col h-full min-h-0 overflow-hidden bg-slate-950 rounded-[32px] ${imageLoading ? 'cursor-wait' : 'cursor-zoom-in'}`}
      onClick={handleStageClick}
    >
      <SceneBackground imageUrl={imageUrl} defaultImageUrl={defaultImageUrl} />

      {/* Painting the scene badge - top-left when loading */}
      {imageLoading && (
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2 px-3 py-1.5 bg-slate-900/85 border border-slate-700 rounded-full backdrop-blur-sm pointer-events-none">
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

      {/* Narration card */}
      <div className="relative z-10 flex-1 min-h-0 flex items-stretch justify-center sm:items-center p-3 pt-14 pb-14 sm:p-4 sm:pt-14 sm:pb-16">
        {narration ? (
          <div
            aria-label="Story narration"
            className={cardClass}
            onClick={e => {
              e.stopPropagation();
              onFullscreenNarration(narration);
            }}
          >
            <p
              ref={narrationTextRef}
              tabIndex={-1}
              onScroll={updateNarrationScrollability}
              className={`${textClass} ${isNarrationScrollable ? 'overflow-y-auto scrollbar-hide' : 'overflow-y-hidden'} ${isNarrationScrollable && !isNarrationAtEnd ? overflowFadeClass : ''} overscroll-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70`}
            >
              {narration}
            </p>
            <div className="mt-4 lg:mt-6 shrink-0" onClick={e => e.stopPropagation()}>
              <NarrationTtsButton
                text={narration}
                ttsSettings={ttsSettings}
                hasTts={hasTts}
                turnId={displayTurn?.id}
                className="justify-center"
              />
            </div>
          </div>
        ) : (
          <div className={emptyCardClass}>
            <p className="font-narrative text-slate-500 italic text-center text-xl">Waiting for the DM...</p>
          </div>
        )}
      </div>
    </div>
  );
};
