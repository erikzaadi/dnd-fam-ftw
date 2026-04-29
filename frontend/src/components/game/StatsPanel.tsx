import type { Character } from '../../types';
import { imgSrc } from '../../lib/api';

const STAT_TEXT_COLORS: Record<string, string> = {
  might: 'text-rose-400',
  magic: 'text-blue-400',
  mischief: 'text-purple-400',
};

interface StatsPanelProps {
  character: Character;
  onShowPartyGear: () => void;
}

export const StatsPanel = ({ character, onShowPartyGear }: StatsPanelProps) => (
  <div className="flex flex-col gap-2 h-full rounded-[32px] border border-slate-800 bg-slate-900 p-4 overflow-y-auto scrollbar-hide">
    <div className="text-xs font-black uppercase tracking-widest text-slate-500 px-1 mb-1">Stats</div>

    {(['might', 'magic', 'mischief'] as const).map(stat => {
      const base = character.stats[stat];
      const bonus = character.inventory.reduce((s, item) => s + (item.statBonuses?.[stat] ?? 0), 0);
      const total = base + bonus;

      return (
        <div
          key={stat}
          className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50"
        >
          <div className="flex items-center gap-2">
            <img
              src={imgSrc(`/images/icon_${stat}.png`)}
              alt={stat}
              className="w-5 h-5 object-contain mix-blend-screen shrink-0"
            />
            <span className="text-sm font-black uppercase tracking-wide text-slate-300">{stat}</span>
          </div>
          <div className={`text-base font-black tabular-nums ${bonus > 0 ? 'text-amber-400' : STAT_TEXT_COLORS[stat]}`}>
            {total}
            {bonus > 0 && (
              <span className="text-xs text-amber-500/70 ml-1">+{bonus}</span>
            )}
          </div>
        </div>
      );
    })}

    <div className="mt-auto pt-3">
      <button
        type="button"
        onClick={onShowPartyGear}
        className="w-full py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800/50 hover:border-amber-500/40 hover:text-amber-400 text-slate-400 text-xs font-black uppercase tracking-widest transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
      >
        Gear [i]
      </button>
    </div>
  </div>
);
