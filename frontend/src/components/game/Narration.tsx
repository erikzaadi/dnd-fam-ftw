import { useEffect, useRef, useState } from 'react';
import type { TurnResult, Character } from '../../types';
import { imgSrc } from '../../lib/api';
import { browserTtsService } from '../../tts/browserTtsService';
import type { TtsSettings } from '../../tts/ttsTypes';

interface NarrationProps {
  history: TurnResult[];
  party: Character[];
  loading: boolean;
  onTurnClick: (i: number) => void;
  onFullscreenNarration?: (narration: string) => void;
  viewedTurnIdx: number;
  ttsSettings?: TtsSettings;
}

export const Narration = ({ history, party, loading, onTurnClick, onFullscreenNarration, viewedTurnIdx, ttsSettings }: NarrationProps) => {
  const ttsActive = !!ttsSettings?.enabled && browserTtsService.isSupported();
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const lastIdx = history.length - 1;
  const scrollRef = useRef<HTMLDivElement>(null);
  const turnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!ttsActive) {
      return;
    }
    const interval = setInterval(() => {
      setTtsPlaying(prev => {
        const speaking = browserTtsService.isSpeaking();
        return prev === speaking ? prev : speaking;
      });
    }, 200);
    return () => clearInterval(interval);
  }, [ttsActive]);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    if (loading) {
      scrollToBottom();
    }
  }, [loading]);

  useEffect(() => {
    if (history.length > 0) {
      scrollToBottom();
    }
  }, [history.length]);

  useEffect(() => {
    turnRefs.current[viewedTurnIdx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [viewedTurnIdx]);

  return (
    <div className="bg-slate-900 rounded-[50px] border border-slate-800 shadow-2xl h-[400px] md:h-[500px] lg:h-full flex flex-col relative overflow-hidden">
      <div ref={scrollRef} className="flex-grow p-4 md:p-10 space-y-4 overflow-y-auto scrollbar-hide">
        {history.map((turn, i) => {
          const isCurrent = i === lastIdx;
          const isSelected = viewedTurnIdx === i;
          // Character who produced this turn (took the action leading here)
          const turnChar = turn.characterId ? party.find(c => c.id === turn.characterId) : null;

          return (
            <button
              key={i}
              ref={el => {
                turnRefs.current[i] = el;
              }}
              onClick={() => onTurnClick(i)}
              className={`w-full text-left p-5 rounded-3xl transition-all flex gap-4 border
                ${isSelected ? 'bg-amber-500/10 border-amber-500/30' : 'border-transparent hover:bg-slate-800/50'}
                ${!isCurrent && !isSelected ? 'opacity-60' : ''}
              `}
            >
              <div className="flex-grow min-w-0">
                {(isCurrent || isSelected) && !loading && (
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    {isCurrent && (
                      <span className="not-italic text-[9px] font-black uppercase tracking-widest text-amber-500">Now</span>
                    )}
                    {ttsActive && isCurrent && (
                      <>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={e => {
                            e.stopPropagation();
                            browserTtsService.speakNarration(turn.narration, ttsSettings!);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation();
                              browserTtsService.speakNarration(turn.narration, ttsSettings!);
                            }
                          }}
                          title="Replay narration"
                          className="not-italic text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-amber-400 transition-colors cursor-pointer"
                        >
                          replay
                        </span>
                        {ttsPlaying && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={e => {
                              e.stopPropagation();
                              browserTtsService.stop();
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                                browserTtsService.stop();
                              }
                            }}
                            title="Stop narration"
                            className="not-italic text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                          >
                            stop
                          </span>
                        )}
                      </>
                    )}
                    {onFullscreenNarration && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={e => {
                          e.stopPropagation();
                          onFullscreenNarration(turn.narration);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            onFullscreenNarration(turn.narration);
                          }
                        }}
                        title="Focus narration"
                        className="not-italic text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
                      >
                        focus
                      </span>
                    )}
                  </div>
                )}
                <p className={`leading-relaxed italic font-narrative ${
                  isCurrent
                    ? 'text-lg md:text-2xl text-slate-100'
                    : isSelected
                      ? 'text-base md:text-lg text-slate-200'
                      : 'text-sm text-slate-400'
                }`}>
                  {turn.narration}
                </p>
              </div>

              {turnChar && (
                <div className="shrink-0 flex flex-col items-center gap-1 w-10">
                  <img
                    src={imgSrc(turnChar.avatarUrl)}
                    className="w-10 h-10 rounded-full object-cover border border-slate-600"
                    alt={turnChar.name}
                  />
                  <span className="text-[8px] font-black uppercase text-slate-500 text-center leading-tight">{turnChar.name}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
