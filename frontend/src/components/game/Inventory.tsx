import { useState, useEffect } from 'react';
import type { Character, InventoryItem } from '../../types';
import { imgSrc } from '../../lib/api';
import { TargetPicker } from './TargetPicker';

interface InventoryProps {
  party: Character[];
  activeCharacterId?: string;
  onUseItem?: (ownerCharId: string, itemId: string, targetCharId: string) => void;
  onGiveItem?: (ownerCharId: string, itemId: string, targetCharId: string) => void;
  disabled?: boolean;
  /** Only show this character's items (no character name header) */
  filterCharId?: string;
  /** Compact right-aligned inline mode for embedding in ActionControls */
  compact?: boolean;
}

type PendingAction = { itemId: string; ownerCharId: string; action: 'use' | 'give' };

const isUsable = (item: InventoryItem) => !!((item.healValue ?? 0) > 0);
const isGiveable = (item: InventoryItem) => !!item.transferable;

export const Inventory = ({ party, activeCharacterId, onUseItem, onGiveItem, disabled, filterCharId, compact }: InventoryProps) => {
  const [pending, setPending] = useState<PendingAction | null>(null);

  const displayParty = filterCharId ? party.filter(c => c.id === filterCharId) : party;
  const partyWithItems = displayParty.filter(c => c.inventory?.length > 0);

  useEffect(() => {
    // Only clear pending if it's actually set
    if (pending) {
      setTimeout(() => setPending(null), 0);
    }
  }, [activeCharacterId, pending]);

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

  const renderItem = (item: InventoryItem, char: Character, isActive: boolean) => {
    const bonuses = item.statBonuses ? Object.entries(item.statBonuses).filter(([, v]) => v && v > 0) : [];
    const canAct = interactive && isActive;
    const canUse = canAct && isUsable(item);
    const canGive = canAct && isGiveable(item) && party.filter(c => c.id !== char.id).length > 0;
    const isPendingThis = pending?.itemId === item.id && pending.ownerCharId === char.id;

    if (compact) {
      return (
        <div key={item.id} className="relative group flex flex-col items-end">
          <div className={`flex flex-col items-end gap-1 px-2 py-1 rounded-xl border transition-colors ${isPendingThis ? 'border-amber-500/60 bg-amber-950/20' : isActive ? 'bg-amber-950/10 border-amber-500/20' : 'bg-slate-800/40 border-slate-700/40'}`}>
            {/* Name + action buttons row */}
            <div className="flex items-center gap-1 justify-end flex-wrap">
              <span className="text-[9px] xl:text-xs text-slate-300 font-black text-right leading-tight max-w-[120px] xl:max-w-[180px]">{item.name}</span>
              {(canUse || canGive) && !isPendingThis && (
                <>
                  {canUse && (
                    <button
                      onClick={() => setPending({ itemId: item.id, ownerCharId: char.id, action: 'use' })}
                      className="px-1.5 py-0.5 rounded text-[8px] xl:text-[10px] font-black uppercase tracking-widest bg-emerald-900/60 text-emerald-400 hover:bg-emerald-800/60 border border-emerald-700/40"
                    >Use</button>
                  )}
                  {canGive && (
                    <button
                      onClick={() => setPending({ itemId: item.id, ownerCharId: char.id, action: 'give' })}
                      className="px-1.5 py-0.5 rounded text-[8px] xl:text-[10px] font-black uppercase tracking-widest bg-blue-900/60 text-blue-400 hover:bg-blue-800/60 border border-blue-700/40"
                    >Give</button>
                  )}
                </>
              )}
            </div>
            {/* Stat/heal badges */}
            {((item.healValue ?? 0) > 0 || bonuses.length > 0) && (
              <div className="flex gap-1 flex-wrap justify-end">
                {(item.healValue ?? 0) > 0 && (
                  <span className="text-[8px] xl:text-[10px] font-black uppercase tracking-widest px-1 xl:px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">+{item.healValue} hp</span>
                )}
                {bonuses.map(([stat, val]) => (
                  <span key={stat} className="text-[8px] xl:text-[10px] font-black uppercase tracking-widest px-1 xl:px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">+{val} {stat}</span>
                ))}
              </div>
            )}
            {/* Target picker */}
            {isPendingThis && (
              <TargetPicker
                compact
                party={party}
                action={pending.action}
                ownerCharId={char.id}
                onConfirm={confirm}
                onCancel={() => setPending(null)}
              />
            )}
          </div>
          {/* Tooltip - appears to the left since items are right-aligned */}
          {item.description && !isPendingThis && (
            <div className="absolute right-full top-0 mr-2 w-48 px-3 py-2 bg-slate-800 border border-slate-600 rounded-xl text-xs text-slate-300 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-normal">
              {item.description}
              <div className="absolute top-3 left-full border-4 border-transparent border-l-slate-600" />
            </div>
          )}
        </div>
      );
    }

    // Full mode item card
    return (
      <div key={item.id} className="relative group">
        <div className={`p-3 rounded-2xl border transition-colors ${isPendingThis ? 'border-amber-500/60 bg-amber-950/20' : isActive ? 'bg-amber-950/20 border-amber-500/30' : 'bg-slate-800/60 border-slate-700/50'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-black text-sm text-slate-200 truncate">{item.name}</p>
              <div className="flex gap-1 mt-1 flex-wrap">
                {(item.healValue ?? 0) > 0 && (
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
          {isPendingThis && (
            <TargetPicker
              party={party}
              action={pending.action}
              ownerCharId={char.id}
              onConfirm={confirm}
              onCancel={() => setPending(null)}
            />
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
  };

  if (compact) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {partyWithItems.flatMap(char => {
          const isActive = char.id === activeCharacterId;
          return char.inventory.map(item => renderItem(item, char, isActive));
        })}
      </div>
    );
  }

  return (
    <div className="bg-slate-900/50 p-4 md:p-8 rounded-[40px] border border-slate-800 shadow-2xl">
      <h3 className="flex items-center gap-2 text-xl font-black uppercase tracking-widest text-amber-500/70 mb-4">
        <img src={imgSrc('/images/icon_inventory.png')} alt="" className="w-25 h-25 object-contain mix-blend-screen rounded-lg" />
        Treasure & Gear
      </h3>
      {partyWithItems.length === 0 ? (
        <p className="text-slate-600 text-sm italic">Empty pockets...</p>
      ) : (
        <div className="space-y-4">
          {partyWithItems.map(char => {
            const isActive = char.id === activeCharacterId;
            return (
              <div key={char.id}>
                {!filterCharId && (
                  <div className="flex items-center gap-2 mb-2">
                    <img src={imgSrc(char.avatarUrl)} className={`w-5 h-5 rounded-full object-cover border border-slate-600 ${char.status === 'downed' ? 'grayscale opacity-40' : ''}`} alt={char.name} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{char.name}{char.status === 'downed' ? ' · downed' : ''}{isActive ? ' · active' : ''}</span>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {char.inventory.map(item => renderItem(item, char, isActive))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
