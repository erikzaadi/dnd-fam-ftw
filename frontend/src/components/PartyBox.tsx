import type { Character } from '../types';
import { imgSrc, pulseSyncDelay } from '../lib/api';

interface PartyBoxProps {
  party: Character[];
  activeCharacterId: string;
  onCharacterClick: (c: Character) => void;
}

const hpBorderClass = (c: Character): string => {
  if (c.status === 'downed') {
    return 'border-slate-700';
  }
  const pct = c.max_hp > 0 ? c.hp / c.max_hp : 0;
  if (pct <= 0.3) {
    return 'border-red-500';
  }
  if (pct <= 0.6) {
    return 'border-amber-500';
  }
  if (pct <= 0.9) {
    return 'border-yellow-400';
  }
  return 'border-green-500';
};

export const PartyBox = ({ party, activeCharacterId, onCharacterClick }: PartyBoxProps) => (
  <div className="flex items-center gap-3 bg-slate-900/50 px-4 py-2 rounded-full border border-slate-800 shadow-xl">
    <div className="flex gap-3 items-center">
      {party.map(c => {
        const isActive = c.id === activeCharacterId && c.status !== 'downed';
        return (
          <div key={c.id} className="relative group flex flex-col items-center gap-1">
            <div className="relative flex items-center justify-center">
              <img
                src={imgSrc(c.avatarUrl)}
                onClick={() => onCharacterClick(c)}
                className={`rounded-full object-cover cursor-pointer border-2 transition-all hover:scale-110 ${c.status === 'downed' ? 'grayscale opacity-40' : ''} ${hpBorderClass(c)} ${isActive ? 'w-16 h-16 xl:w-20 xl:h-20 animate-border-pulse' : 'w-11 h-11 xl:w-14 xl:h-14'}`}
                style={isActive ? { animationDelay: pulseSyncDelay() } : undefined}
                alt={c.name}
              />
              {c.status === 'downed' && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full pointer-events-none">
                  <span className="text-lg">💀</span>
                </div>
              )}
            </div>
            <span className={`font-black uppercase tracking-widest leading-none truncate text-center ${isActive ? 'text-[10px] xl:text-xs text-amber-400 max-w-[64px] xl:max-w-[80px]' : 'text-[8px] xl:text-[10px] text-slate-500 max-w-[44px] xl:max-w-[56px]'}`}>
              {c.name.split(' ')[0]}
            </span>
            {/* Tooltip */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-7 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
              {c.name}{c.status === 'downed' ? ' · DOWNED' : ` · ${c.hp}/${c.max_hp} HP`}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-700" />
            </div>
          </div>
        );
      })}
    </div>
  </div>
);
