import type { Character } from '../types';
import { imgSrc, pulseSyncDelay } from '../lib/api';
import { Tooltip } from './Tooltip';

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
  <div className="flex items-center gap-3 bg-slate-950/60 backdrop-blur-md px-5 py-2 rounded-full border border-slate-800 shadow-xl pointer-events-auto">
    <div className="flex gap-3 items-center">
      {party.map(c => {
        const isActive = c.id === activeCharacterId && c.status !== 'downed';
        return (
          <Tooltip
            key={c.id}
            content={`${c.name}${c.status === 'downed' ? ' · DOWNED' : ` · ${c.hp}/${c.max_hp} HP`}`}
            position="bottom"
            as="div"
            wrapperClassName="flex flex-col items-center gap-1"
          >
            <div className="relative flex items-center justify-center">
              <img
                src={imgSrc(c.avatarUrl)}
                onClick={() => onCharacterClick(c)}
                className={`rounded-full object-cover cursor-pointer border-2 transition-all hover:scale-110 ${c.status === 'downed' ? 'grayscale opacity-40' : ''} ${hpBorderClass(c)} ${isActive ? 'w-12 h-12 xl:w-14 xl:h-14 animate-border-pulse' : 'w-9 h-9 xl:w-11 xl:h-11'}`}
                style={isActive ? { animationDelay: pulseSyncDelay() } : undefined}
                alt={c.name}
              />
              {c.status === 'downed' && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full pointer-events-none">
                  <span className="text-lg">💀</span>
                </div>
              )}
            </div>
            <span className={`font-black uppercase tracking-widest leading-none truncate text-center ${isActive ? 'text-[9px] xl:text-[10px] text-amber-400 max-w-[48px] xl:max-w-[56px]' : 'text-[8px] xl:text-[9px] text-slate-500 max-w-[36px] xl:max-w-[44px]'}`}>
              {c.name.split(' ')[0]}
            </span>
          </Tooltip>
        );
      })}
    </div>
  </div>
);
