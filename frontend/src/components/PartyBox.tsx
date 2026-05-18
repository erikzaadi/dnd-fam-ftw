import type { Character } from '../types';
import { imgSrc, pulseSyncDelay } from '../lib/api';
import { Tooltip } from './Tooltip';
import { useRef } from 'react';
import type { ReactNode } from 'react';

interface PartyBoxProps {
  party: Character[];
  activeCharacterId: string;
  onCharacterClick: (c: Character) => void;
  onBlessCharacter?: (targetCharacterId: string) => void;
  onAidCharacter?: (targetCharacterId: string) => void;
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

const tooltipContent = (c: Character, isActor: boolean, canSupport: boolean): ReactNode => {
  const hp = c.status === 'downed' ? 'DOWNED' : `${c.hp}/${c.max_hp} HP`;
  const buffs = (c.buffs ?? []).map(buff => buff.name).join(', ');
  return (
    <div className="flex flex-col gap-1 text-center min-w-[120px]">
      <div className="font-black text-amber-500">{c.name}</div>
      <div className="text-slate-300 text-[10px]">{hp}{buffs ? ` · ${buffs}` : ''}</div>
      {canSupport && !isActor && (
        <div className="mt-1 pt-1 border-t border-slate-700/50 flex flex-col gap-0.5">
          <div className="text-[9px] text-blue-400/90 font-black tracking-wider uppercase">Press [B] to Bless</div>
          <div className="text-[9px] text-emerald-400/90 font-black tracking-wider uppercase">Press [A] to Aid</div>
        </div>
      )}
      {isActor && (
        <div className="mt-1 pt-1 border-t border-slate-700/50 text-[9px] text-amber-500/70 font-black uppercase tracking-widest italic">
          Active Hero
        </div>
      )}
    </div>
  );
};

export const PartyBox = ({
  party,
  activeCharacterId,
  onCharacterClick,
  onBlessCharacter,
  onAidCharacter,
  onPartyBoost,
  previewThinking
}: PartyBoxProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleArrowNav = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const focusables = containerRef.current?.querySelectorAll('button');
      if (!focusables) {
        return;
      }
      const index = Array.from(focusables).indexOf(e.currentTarget as HTMLButtonElement);
      if (index === -1) {
        return;
      }

      const nextIndex = e.key === 'ArrowRight'
        ? (index + 1) % focusables.length
        : (index - 1 + focusables.length) % focusables.length;
      (focusables[nextIndex] as HTMLButtonElement).focus();
      e.preventDefault();
    }
  };

  const handleCharKeyDown = (e: React.KeyboardEvent, character: Character) => {
    const isActor = character.id === activeCharacterId;
    const canSupport = !isActor && character.status !== 'downed' && !previewThinking;

    if (e.key === 'b' && canSupport && onBlessCharacter) {
      e.preventDefault();
      onBlessCharacter(character.id);
    } else if (e.key === 'a' && canSupport && onAidCharacter) {
      e.preventDefault();
      onAidCharacter(character.id);
    } else {
      handleArrowNav(e);
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex items-center gap-3 bg-slate-950/60 backdrop-blur-md px-5 py-2 rounded-full border border-slate-800 shadow-xl pointer-events-auto"
    >
      <div className="flex gap-3 items-center">
        {party.map(c => {
          const isActive = c.id === activeCharacterId && c.status !== 'downed';
          const canSupport = !isActive && c.status !== 'downed' && !previewThinking;

          return (
            <Tooltip
              key={c.id}
              content={tooltipContent(c, c.id === activeCharacterId, canSupport)}
              position="bottom"
              as="div"
              wrapperClassName="flex flex-col items-center gap-1"
            >
              <button
                type="button"
                onClick={() => onCharacterClick(c)}
                onKeyDown={(e) => handleCharKeyDown(e, c)}
                className={`relative flex items-center justify-center rounded-full transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${isActive ? 'w-12 h-12 xl:w-14 xl:h-14' : 'w-9 h-9 xl:w-11 xl:h-11'}`}
                aria-label={`${c.name} - ${c.hp}/${c.max_hp} HP. Press B to bless, A to aid.`}
              >
                {c.avatarUrl ? (
                  <img
                    src={imgSrc(c.avatarUrl)}
                    className={`w-full h-full rounded-full object-cover border-2 ${c.status === 'downed' ? 'grayscale opacity-40' : ''} ${hpBorderClass(c)} ${isActive ? 'animate-border-pulse' : ''}`}
                    style={isActive ? { animationDelay: pulseSyncDelay() } : undefined}
                    alt=""
                  />
                ) : (
                  <div
                    className={`w-full h-full rounded-full border-2 animate-pulse bg-slate-700 ${hpBorderClass(c)}`}
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
              </button>
              <span className={`font-black uppercase tracking-widest leading-none truncate text-center ${isActive ? 'text-[9px] xl:text-[10px] text-amber-400 max-w-[48px] xl:max-w-[56px]' : 'text-[8px] xl:text-[9px] text-slate-500 max-w-[36px] xl:max-w-[44px]'}`}>
                {c.name.split(' ')[0]}
              </span>
            </Tooltip>
          );
        })}
      </div>
      {onPartyBoost && (
        <Tooltip content={
          <div className="text-center">
            <div className="font-black text-emerald-400">Party Rally</div>
            <div className="text-[9px] text-slate-400 uppercase tracking-widest mt-1">Press [R] or click</div>
          </div>
        } position="bottom" groupName="use">
          <button
            type="button"
            onClick={onPartyBoost}
            onKeyDown={handleArrowNav}
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
};

