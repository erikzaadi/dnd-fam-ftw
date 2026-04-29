import { useState } from 'react';
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
  activeStatKey?: string | null;
}

export const StatsPanel = ({ character, onShowPartyGear, activeStatKey = null }: StatsPanelProps) => {
  const [expandedStat, setExpandedStat] = useState<string | null>(null);

  const toggleStat = (key: string) => {
    setExpandedStat(cur => (cur === key ? null : key));
  };

  return (
    <div className="flex flex-col gap-2 h-full rounded-[32px] border border-slate-800 bg-slate-900 p-4 overflow-y-auto scrollbar-hide">
      <div className="text-xs font-black uppercase tracking-widest text-slate-500 px-1 mb-1">Stats</div>

      {(['might', 'magic', 'mischief'] as const).map(stat => {
        const base = character.stats[stat];
        const bonusItems = character.inventory.filter(item => (item.statBonuses?.[stat] ?? 0) > 0);
        const bonus = bonusItems.reduce((s, item) => s + (item.statBonuses![stat]!), 0);
        const total = base + bonus;
        const hasBonus = bonus > 0;
        const isExpanded = expandedStat === stat;
        const isActive = activeStatKey === stat;

        const rowClass = `rounded-xl bg-slate-800/50 border transition-all duration-150 ${
          isActive
            ? 'border-amber-500/40 ring-1 ring-amber-500/20 bg-amber-950/10'
            : 'border-slate-700/50'
        }`;

        const header = (
          <div className="flex items-center justify-between gap-2 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <img
                src={imgSrc(`/images/icon_${stat}.png`)}
                alt={stat}
                className="w-5 h-5 object-contain mix-blend-screen shrink-0"
              />
              <span className="text-sm font-black uppercase tracking-wide text-slate-300">{stat}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className={`text-base font-black tabular-nums ${hasBonus ? 'text-amber-400' : STAT_TEXT_COLORS[stat]}`}>
                {total}
              </span>
              {hasBonus && (
                <span className={`text-slate-400 text-xs ml-0.5 inline-block transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}>
                  ›
                </span>
              )}
            </div>
          </div>
        );

        return (
          <div key={stat} className={rowClass}>
            {hasBonus ? (
              <button
                type="button"
                onClick={() => toggleStat(stat)}
                aria-expanded={isExpanded}
                className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300 rounded-xl"
              >
                {header}
              </button>
            ) : (
              <div>{header}</div>
            )}

            {isExpanded && hasBonus && (
              <div className="flex flex-col gap-1 px-3 pb-2.5 text-xs border-t border-slate-700/50 pt-2">
                <div className="text-slate-500">{base} base</div>
                {bonusItems.map(item => (
                  <div key={item.id} className="text-amber-400/80">
                    +{item.statBonuses![stat]} {item.name}
                  </div>
                ))}
              </div>
            )}
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
};
