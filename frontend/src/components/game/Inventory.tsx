import type { Character } from '../../types';
import { imgSrc } from '../../lib/api';

interface InventoryProps {
  party: Character[];
}

export const Inventory = ({ party }: InventoryProps) => {
  const partyWithItems = party.filter(c => c.inventory?.length > 0);

  return (
    <div className="bg-slate-900 p-4 md:p-8 rounded-[40px] border border-slate-800 shadow-2xl">
      <h3 className="text-sm font-black uppercase tracking-widest text-amber-500/70 mb-4">Treasure & Gear</h3>
      {partyWithItems.length === 0 ? (
        <p className="text-slate-600 text-sm italic">Empty pockets...</p>
      ) : (
        <div className="space-y-4">
          {partyWithItems.map(char => (
            <div key={char.id}>
              <div className="flex items-center gap-2 mb-2">
                <img src={imgSrc(char.avatarUrl)} className="w-5 h-5 rounded-full object-cover border border-slate-600" alt={char.name} />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{char.name}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {char.inventory.map((item, i) => {
                  const bonuses = item.statBonuses ? Object.entries(item.statBonuses).filter(([, v]) => v && v > 0) : [];
                  return (
                    <div key={i} className="relative group p-3 bg-slate-800/60 rounded-2xl border border-slate-700/50 cursor-default">
                      <p className="font-black text-sm text-slate-200 truncate">{item.name}</p>
                      {bonuses.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {bonuses.map(([stat, val]) => (
                            <span key={stat} className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">+{val} {stat}</span>
                          ))}
                        </div>
                      )}
                      {item.description && (
                        <div className="absolute bottom-full left-0 mb-2 w-56 px-3 py-2 bg-slate-800 border border-slate-600 rounded-xl text-xs text-slate-300 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                          {item.description}
                          <div className="absolute top-full left-6 border-4 border-transparent border-t-slate-600" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
