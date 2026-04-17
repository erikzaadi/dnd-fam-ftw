import { useState } from 'react';
import type { Character, InventoryItem } from '../../types';
import { imgSrc } from '../../lib/api';

interface InventoryProps {
  party: Character[];
  activeCharacterId?: string;
  onUseItem?: (ownerCharId: string, itemId: string, targetCharId: string) => void;
  onGiveItem?: (ownerCharId: string, itemId: string, targetCharId: string) => void;
  disabled?: boolean;
}

type PendingAction = { itemId: string; ownerCharId: string; action: 'use' | 'give' };

const isUsable = (item: InventoryItem) => !!(item.healValue && item.healValue > 0);
const isGiveable = (item: InventoryItem) => !!item.transferable;

export const Inventory = ({ party, activeCharacterId, onUseItem, onGiveItem, disabled }: InventoryProps) => {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const partyWithItems = party.filter(c => c.inventory?.length > 0);
  const interactive = !!(onUseItem || onGiveItem) && !disabled;

  const confirm = (targetCharId: string) => {
    if (!pending) {
      return;
    }
    if (pending.action === 'use') {
      onUseItem?.(pending.ownerCharId, pending.itemId, targetCharId);
    } else {
      onGiveItem?.(pending.ownerCharId, pending.itemId, targetCharId);
    }
    setPending(null);
  };

  return (
    <div className="bg-slate-900/50 p-4 md:p-8 rounded-[40px] border border-slate-800 shadow-2xl">
      <h3 className="text-sm font-black uppercase tracking-widest text-amber-500/70 mb-4">Treasure & Gear</h3>
      {partyWithItems.length === 0 ? (
        <p className="text-slate-600 text-sm italic">Empty pockets...</p>
      ) : (
        <div className="space-y-4">
          {partyWithItems.map(char => {
            const isActive = char.id === activeCharacterId;
            return (
              <div key={char.id}>
                <div className="flex items-center gap-2 mb-2">
                  <img src={imgSrc(char.avatarUrl)} className={`w-5 h-5 rounded-full object-cover border border-slate-600 ${char.status === 'downed' ? 'grayscale opacity-40' : ''}`} alt={char.name} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{char.name}{char.status === 'downed' ? ' · downed' : ''}{isActive ? ' · active' : ''}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {char.inventory.map((item) => {
                    const bonuses = item.statBonuses ? Object.entries(item.statBonuses).filter(([, v]) => v && v > 0) : [];
                    const canAct = interactive && isActive;
                    const canUse = canAct && isUsable(item);
                    const canGive = canAct && isGiveable(item) && party.filter(c => c.id !== char.id).length > 0;
                    const isPendingThis = pending?.itemId === item.id && pending.ownerCharId === char.id;

                    return (
                      <div key={item.id} className="relative group">
                        <div className={`p-3 rounded-2xl border transition-colors ${isPendingThis ? 'border-amber-500/60 bg-amber-950/20' : isActive ? 'bg-amber-950/20 border-amber-500/30' : 'bg-slate-800/60 border-slate-700/50'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-black text-sm text-slate-200 truncate">{item.name}</p>
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {item.healValue && item.healValue > 0 && (
                                  <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">+{item.healValue} hp</span>
                                )}
                                {bonuses.map(([stat, val]) => (
                                  <span key={stat} className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">+{val} {stat}</span>
                                ))}
                              </div>
                            </div>
                            {(canUse || canGive) && !isPendingThis && (
                              <div className="flex gap-1 shrink-0">
                                {canUse && (
                                  <button
                                    onClick={() => setPending({ itemId: item.id, ownerCharId: char.id, action: 'use' })}
                                    className="px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-emerald-900/60 text-emerald-400 hover:bg-emerald-800/60 border border-emerald-700/40"
                                  >Use</button>
                                )}
                                {canGive && (
                                  <button
                                    onClick={() => setPending({ itemId: item.id, ownerCharId: char.id, action: 'give' })}
                                    className="px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-blue-900/60 text-blue-400 hover:bg-blue-800/60 border border-blue-700/40"
                                  >Give</button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Target picker */}
                          {isPendingThis && (
                            <div className="mt-2 pt-2 border-t border-slate-700">
                              <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-2">
                                {pending.action === 'use' ? 'Use on:' : 'Give to:'}
                              </p>
                              <div className="flex gap-2 flex-wrap">
                                {party
                                  .filter(t => pending.action === 'use' ? true : t.id !== char.id)
                                  .map(target => (
                                    <button
                                      key={target.id}
                                      onClick={() => confirm(target.id)}
                                      title={target.name}
                                      className="flex flex-col items-center gap-1 group/target"
                                    >
                                      <img
                                        src={imgSrc(target.avatarUrl)}
                                        className={`w-9 h-9 rounded-full object-cover border-2 transition-all group-hover/target:scale-110 ${target.status === 'downed' ? 'grayscale opacity-50 border-slate-600' : 'border-slate-600 group-hover/target:border-amber-500'}`}
                                        alt={target.name}
                                      />
                                      <span className="text-[8px] font-black uppercase tracking-widest text-slate-500 group-hover/target:text-amber-400">{target.name.split(' ')[0]}</span>
                                    </button>
                                  ))}
                                <button onClick={() => setPending(null)} className="self-start px-2 py-1 text-[9px] text-slate-600 hover:text-slate-400 font-black uppercase">✕</button>
                              </div>
                            </div>
                          )}

                          {item.description && !isPendingThis && (
                            <div className="absolute bottom-full left-0 mb-2 w-56 px-3 py-2 bg-slate-800 border border-slate-600 rounded-xl text-xs text-slate-300 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                              {item.description}
                              <div className="absolute top-full left-6 border-4 border-transparent border-t-slate-600" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
