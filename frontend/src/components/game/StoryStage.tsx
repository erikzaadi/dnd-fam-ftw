import type { TurnResult } from '../../types';
import { imgSrc } from '../../lib/api';
import type { TtsSettings } from '../../tts/ttsTypes';
import { TtsButton } from '../TtsButton';
import { SceneBackground } from './SceneBackground';

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
  chronicleOpen: boolean;
  currentTensionLevel?: 'low' | 'medium' | 'high' | null;
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
  currentTensionLevel,
  onOpenChronicle,
  onFullscreenImage,
  onFullscreenNarration,
}: StoryStageProps) => {

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
      <div className="relative z-10 flex-1 flex items-center justify-center p-4">
        {narration ? (
          <div
            className="story-card-container backdrop-blur-md bg-slate-950/55 rounded-[24px] p-8 lg:p-12 w-[78%] h-[75%] flex flex-col items-center justify-center cursor-pointer hover:bg-slate-950/65 transition-colors overflow-y-auto scrollbar-hide"
            onClick={e => {
              e.stopPropagation();
              onFullscreenNarration(narration);
            }}
          >
            <p className="font-narrative text-slate-100 italic text-center main-story-text">
              {narration}
            </p>
            <div className="mt-6" onClick={e => e.stopPropagation()}>
              <TtsButton text={narration} ttsSettings={ttsSettings} className="justify-center" />
            </div>
          </div>
        ) : null}
      </div>

      {/* Previous turn teaser + Chronicle link - fades out when chronicle is open */}
      <div
        className={`relative z-10 flex items-center justify-between px-6 py-3 gap-4 transition-opacity duration-300 ${chronicleOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
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
          className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-amber-600 hover:text-amber-400 transition-colors shrink-0 whitespace-nowrap"
        >
          <img src={imgSrc('/images/icon_scroll.png')} alt="" className="w-4 h-4 object-contain mix-blend-screen" />
          Open Chronicle →
        </button>
      </div>
    </div>
  );
};
