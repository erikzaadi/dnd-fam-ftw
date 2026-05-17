import type { Character } from '../types';
import { imgSrc, pulseSyncDelay } from '../lib/api';
import { Tooltip } from './Tooltip';

interface PartyBoxProps {
  party: Character[];
  activeCharacterId: string;
  onCharacterClick: (c: Character) => void;
  onPartyBoost?: () => void;
  previewThinking?: boolean;
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

const tooltipContent = (c: Character): string => {
  const hp = c.status === 'downed' ? 'DOWNED' : `${c.hp}/${c.max_hp} HP`;
  const buffs = (c.buffs ?? []).map(buff => buff.name).join(', ');
  return `${c.name} · ${hp}${buffs ? ` · ${buffs}` : ''}`;
};

export const PartyBox = ({ party, activeCharacterId, onCharacterClick, onPartyBoost, previewThinking }: PartyBoxProps) => (
  <div className="flex items-center gap-3 bg-slate-950/60 backdrop-blur-md px-5 py-2 rounded-full border border-slate-800 shadow-xl pointer-events-auto">
    <div className="flex gap-3 items-center">
      {party.map(c => {
        const isActive = c.id === activeCharacterId && c.status !== 'downed';
        return (
          <Tooltip
            key={c.id}
            content={tooltipContent(c)}
            position="bottom"
            as="div"
            wrapperClassName="flex flex-col items-center gap-1"
          >
            <div className="relative flex items-center justify-center">
              {c.avatarUrl ? (
                <img
                  src={imgSrc(c.avatarUrl)}
                  onClick={() => onCharacterClick(c)}
                  className={`rounded-full object-cover cursor-pointer border-2 transition-all hover:scale-110 ${c.status === 'downed' ? 'grayscale opacity-40' : ''} ${hpBorderClass(c)} ${isActive ? 'w-12 h-12 xl:w-14 xl:h-14 animate-border-pulse' : 'w-9 h-9 xl:w-11 xl:h-11'}`}
                  style={isActive ? { animationDelay: pulseSyncDelay() } : undefined}
                  alt={c.name}
                />
              ) : (
                <div
                  onClick={() => onCharacterClick(c)}
                  className={`rounded-full cursor-pointer border-2 animate-pulse bg-slate-700 ${hpBorderClass(c)} ${isActive ? 'w-12 h-12 xl:w-14 xl:h-14' : 'w-9 h-9 xl:w-11 xl:h-11'}`}
                />
              )}
              {c.status === 'downed' && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full pointer-events-none">
                  <span className="text-lg">💀</span>
                </div>
              )}
              {c.status !== 'downed' && (c.buffs?.length ?? 0) > 0 && (
                <span className={`absolute -right-1 -bottom-0.5 w-3 h-3 rounded-full border-2 border-slate-950 ${c.buffs?.some(buff => buff.kind === 'curse') ? 'bg-rose-400' : 'bg-emerald-400'}`} />
              )}
            </div>
            <span className={`font-black uppercase tracking-widest leading-none truncate text-center ${isActive ? 'text-[9px] xl:text-[10px] text-amber-400 max-w-[48px] xl:max-w-[56px]' : 'text-[8px] xl:text-[9px] text-slate-500 max-w-[36px] xl:max-w-[44px]'}`}>
              {c.name.split(' ')[0]}
            </span>
          </Tooltip>
        );
      })}
    </div>
    {onPartyBoost && (
      <Tooltip content={previewThinking ? 'Thinking...' : 'Preview a party boost'} position="bottom" groupName="use">
        <button
          type="button"
          onClick={onPartyBoost}
          disabled={previewThinking}
          className="ml-1 flex h-9 w-9 items-center justify-center rounded-full border border-emerald-700/50 bg-emerald-950/50 text-xs font-black text-emerald-200 transition-all hover:bg-emerald-900/60 hover:border-emerald-500/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Preview party boost"
        >
          {previewThinking ? '…' : '✦'}
        </button>
      </Tooltip>
    )}
  </div>
);
