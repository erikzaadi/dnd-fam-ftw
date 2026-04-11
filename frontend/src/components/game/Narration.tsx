import { useEffect, useRef } from 'react';
import type { TurnResult, Character } from '../../types';
import { imgSrc } from '../../lib/api';

interface NarrationProps {
  history: TurnResult[];
  party: Character[];
  loading: boolean;
  onTurnClick: (i: number) => void;
  viewedTurnIdx: number;
}

export const Narration = ({ history, party, loading, onTurnClick, viewedTurnIdx }: NarrationProps) => {
  const lastIdx = history.length - 1;
  const scrollRef = useRef<HTMLDivElement>(null);

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
              onClick={() => onTurnClick(i)}
              className={`w-full text-left p-5 rounded-3xl transition-all flex gap-4 border
                ${isSelected ? 'bg-amber-500/10 border-amber-500/30' : 'border-transparent hover:bg-slate-800/50'}
                ${!isCurrent && !isSelected ? 'opacity-60' : ''}
              `}
            >
              <div className="flex-grow min-w-0">
                {isCurrent && (
                  <span className={`not-italic text-[9px] font-black uppercase tracking-widest mb-2 block ${loading ? 'text-slate-400 animate-pulse' : 'text-amber-500'}`}>
                    {loading ? '⚙ Computing...' : 'Now'}
                  </span>
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
        {loading && <div className="p-6 text-amber-500 animate-pulse">DM is narrating...</div>}
      </div>
    </div>
  );
};
