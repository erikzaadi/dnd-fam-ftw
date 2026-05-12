import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Character, InventoryItem, Stat } from '../../types';
import { imgSrc } from '../../lib/api';
import { TargetPicker } from './TargetPicker';
import { Tooltip } from '../Tooltip';
import { ItemBonusBadge } from '../ItemBonusBadge';
import { ActionButton } from '../ActionButton';

interface InventoryProps {
  party: Character[];
  activeCharacterId?: string;
  onUseItem?: (ownerCharId: string, itemId: string, targetCharId: string) => void;
  onUseItemInScene?: (ownerCharId: string, itemId: string) => void;
  onImproveItemInScene?: (ownerCharId: string, itemId: string, method: 'enchant' | 'craft' | 'tinker') => void;
  onGiveItem?: (ownerCharId: string, itemId: string, targetCharId: string) => void;
  disabled?: boolean;
  previewThinking?: boolean;
  /** Only show this character's items (no character name header) */
  filterCharId?: string;
  /** Compact right-aligned inline mode for embedding in ActionControls */
  compact?: boolean;
}

type PendingAction = { itemId: string; ownerCharId: string; action: 'use' | 'give' };

const isUsable = (item: InventoryItem) => !!((item.healValue ?? 0) > 0);
const isGiveable = (item: InventoryItem) => item.transferable !== false;

interface InventoryItemCardProps {
  item: InventoryItem;
  active?: boolean;
  pending?: boolean;
  canUse?: boolean;
  canUseInScene?: boolean;
  canGive?: boolean;
  onUse?: () => void;
  onUseInScene?: () => void;
  onGive?: () => void;
  sceneActions?: ReactNode;
  targetPicker?: ReactNode;
}

export const InventoryItemCard = ({
  item,
  active = false,
  pending = false,
  canUse = false,
  canUseInScene = false,
  canGive = false,
  onUse,
  onUseInScene,
  onGive,
  sceneActions,
  targetPicker,
}: InventoryItemCardProps) => {
  const bonuses = item.statBonuses ? Object.entries(item.statBonuses).filter(([, v]) => v && v > 0) : [];
  const hasEvolution = !!(item.condition || item.effect || item.charges !== undefined || (item.tags && item.tags.length > 0) || item.boundToCharacterId);

  return (
    <div className={`p-3 rounded-2xl border transition-colors min-w-0 ${pending ? 'border-amber-500/60 bg-amber-950/20' : active ? 'bg-amber-950/20 border-amber-500/30' : 'bg-slate-800/60 border-slate-700/50'}`}>
      <div className="flex items-start justify-between gap-2 min-w-0">
        <Tooltip as="div" content={pending ? undefined : item.description} position="top" portal variant="description" wrapperClassName="min-w-0 flex-1">
          <p className="font-black text-sm text-slate-200 truncate">{item.name}</p>
          <div className="flex gap-1 mt-1 flex-wrap">
            {(item.healValue ?? 0) > 0 && (
              <ItemBonusBadge type="hp" value={item.healValue!} label="hp" />
            )}
            {bonuses.map(([stat, val]) => (
              <ItemBonusBadge key={stat} type="stat" value={val!} label={stat} />
            ))}
            {item.condition && (
              <span className="px-1.5 py-0.5 rounded bg-indigo-900/40 border border-indigo-700/50 text-[9px] font-black uppercase tracking-wider text-indigo-300">{item.condition}</span>
            )}
            {item.charges !== undefined && (
              <span className="px-1.5 py-0.5 rounded bg-sky-900/40 border border-sky-700/50 text-[9px] font-black uppercase tracking-wider text-sky-300">{item.charges} charge{item.charges === 1 ? '' : 's'}</span>
            )}
          </div>
        </Tooltip>
        {(canUse || canUseInScene || canGive || sceneActions) && !pending && (
          <div className="flex gap-1 shrink-0">
            {canUse && onUse && (
              <Tooltip content="Use this item" position="top" groupName="use">
                <ActionButton action="use" onClick={onUse} />
              </Tooltip>
            )}
            {canUseInScene && onUseInScene && (
              <Tooltip content="Preview how this gear could help now" position="top" groupName="use">
                <ActionButton action="use" onClick={onUseInScene} />
              </Tooltip>
            )}
            {canGive && onGive && (
              <Tooltip content="Give to another character" position="top" groupName="give">
                <ActionButton action="give" onClick={onGive} />
              </Tooltip>
            )}
            {sceneActions}
          </div>
        )}
      </div>
      {targetPicker}
      {hasEvolution && !pending && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.tags?.map(tag => (
            <span key={tag} className="px-1.5 py-0.5 rounded bg-slate-950/60 border border-slate-700/60 text-[9px] font-black uppercase tracking-wider text-slate-400">{tag}</span>
          ))}
          {item.effect && (
            <span className="text-[10px] leading-snug text-slate-400">{item.effect}</span>
          )}
          {item.boundToCharacterId && (
            <span className="px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-700/40 text-[9px] font-black uppercase tracking-wider text-amber-300">bonded</span>
          )}
        </div>
      )}
    </div>
  );
};

const strongestStat = (character: Character | undefined): Stat => {
  if (!character) {
    return 'mischief';
  }
  const entries: Array<{ stat: Stat; value: number }> = [
    { stat: 'might', value: character.stats.might },
    { stat: 'magic', value: character.stats.magic },
    { stat: 'mischief', value: character.stats.mischief },
  ];
  return entries.sort((a, b) => b.value - a.value)[0]?.stat ?? 'mischief';
};

const improveMethodFor = (stat: Stat): 'enchant' | 'craft' | 'tinker' => {
  if (stat === 'magic') {
    return 'enchant';
  }
  if (stat === 'might') {
    return 'craft';
  }
  return 'tinker';
};

const improveLabel = (method: 'enchant' | 'craft' | 'tinker'): string => {
  if (method === 'enchant') {
    return 'Enchant';
  }
  if (method === 'craft') {
    return 'Craft';
  }
  return 'Tinker';
};

export const Inventory = ({ party, activeCharacterId, onUseItem, onUseItemInScene, onImproveItemInScene, onGiveItem, disabled, previewThinking, filterCharId, compact }: InventoryProps) => {
  const [pending, setPending] = useState<PendingAction | null>(null);

  const displayParty = filterCharId ? party.filter(c => c.id === filterCharId) : party;
  const partyWithItems = displayParty.filter(c => c.inventory?.length > 0);
  const activeCharacter = party.find(c => c.id === activeCharacterId);
  const improveMethod = improveMethodFor(strongestStat(activeCharacter));
  const improveButtonLabel = improveLabel(improveMethod);

  useEffect(() => {
    const timeout = window.setTimeout(() => setPending(null), 0);
    return () => window.clearTimeout(timeout);
  }, [activeCharacterId]);

  const interactive = !!(onUseItem || onUseItemInScene || onImproveItemInScene || onGiveItem) && !disabled;

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
    const hasEvolution = !!(item.condition || item.effect || item.charges !== undefined || (item.tags && item.tags.length > 0) || item.boundToCharacterId);
    const canAct = interactive && isActive;
    const canUse = canAct && isUsable(item);
    const canUseInScene = canAct && !canUse && !!onUseItemInScene;
    const canImproveInScene = interactive && !!onImproveItemInScene && !!activeCharacterId;
    const canGive = canAct && isGiveable(item) && party.filter(c => c.id !== char.id).length > 0;
    const isPendingThis = pending?.itemId === item.id && pending.ownerCharId === char.id;
    const sceneImproveButton = canImproveInScene && !isPendingThis ? (
      <Tooltip content={previewThinking ? 'Thinking...' : `${improveButtonLabel} this gear in the scene`} position="top" groupName="use">
        <button
          type="button"
          onClick={() => onImproveItemInScene?.(char.id, item.id, improveMethod)}
          disabled={previewThinking}
          className={`${compact ? 'px-1.5 py-0.5 rounded text-[8px] xl:text-[10px]' : 'px-2.5 py-1 rounded-lg text-xs'} font-black uppercase tracking-widest bg-indigo-900/60 text-indigo-300 hover:bg-indigo-800/60 border border-indigo-700/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {previewThinking ? 'Thinking...' : improveButtonLabel}
        </button>
      </Tooltip>
    ) : null;

    if (compact) {
      return (
        <Tooltip key={item.id} as="div" content={isPendingThis ? undefined : item.description} position="left" portal variant="description" wrapperClassName="flex flex-col items-end">
          <div className={`flex flex-col items-end gap-1 px-2 py-1 rounded-xl border transition-colors ${isPendingThis ? 'border-amber-500/60 bg-amber-950/20' : isActive ? 'bg-amber-950/10 border-amber-500/20' : 'bg-slate-800/40 border-slate-700/40'}`}>
            {/* Name + action buttons row */}
            <div className="flex items-center gap-1 justify-end flex-wrap">
              <span className="text-[9px] xl:text-xs text-slate-300 font-black text-right leading-tight max-w-[120px] xl:max-w-[180px]">{item.name}</span>
              {(canUse || canUseInScene || canGive || sceneImproveButton) && !isPendingThis && (
                <>
                  {canUse && (
                    <Tooltip content="Use this item" position="top" groupName="use">
                      <ActionButton compact action="use" onClick={() => setPending({ itemId: item.id, ownerCharId: char.id, action: 'use' })} />
                    </Tooltip>
                  )}
                  {canUseInScene && (
                    <Tooltip content="Preview how this gear could help now" position="top" groupName="use">
                      <ActionButton compact action="use" onClick={() => onUseItemInScene?.(char.id, item.id)} />
                    </Tooltip>
                  )}
                  {canGive && (
                    <Tooltip content="Give to another character" position="top" groupName="give">
                      <ActionButton compact action="give" onClick={() => setPending({ itemId: item.id, ownerCharId: char.id, action: 'give' })} />
                    </Tooltip>
                  )}
                  {sceneImproveButton}
                </>
              )}
            </div>
            {/* Stat/heal badges */}
            {((item.healValue ?? 0) > 0 || bonuses.length > 0) && (
              <div className="flex gap-1 flex-wrap justify-end">
                {(item.healValue ?? 0) > 0 && (
                  <ItemBonusBadge compact type="hp" value={item.healValue!} label="hp" />
                )}
                {bonuses.map(([stat, val]) => (
                  <ItemBonusBadge compact key={stat} type="stat" value={val!} label={stat} />
                ))}
              </div>
            )}
            {hasEvolution && (
              <div className="flex gap-1 flex-wrap justify-end">
                {item.condition && (
                  <span className="px-1.5 py-0.5 rounded bg-indigo-900/40 border border-indigo-700/50 text-[9px] font-black uppercase tracking-wider text-indigo-300">{item.condition}</span>
                )}
                {item.charges !== undefined && (
                  <span className="px-1.5 py-0.5 rounded bg-sky-900/40 border border-sky-700/50 text-[9px] font-black uppercase tracking-wider text-sky-300">{item.charges}</span>
                )}
                {item.boundToCharacterId && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-700/40 text-[9px] font-black uppercase tracking-wider text-amber-300">bonded</span>
                )}
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
        </Tooltip>
      );
    }

    return (
      <InventoryItemCard
        key={item.id}
        item={item}
        active={isActive}
        pending={isPendingThis}
        canUse={canUse}
        canUseInScene={canUseInScene}
        canGive={canGive}
        onUse={() => setPending({ itemId: item.id, ownerCharId: char.id, action: 'use' })}
        onUseInScene={() => onUseItemInScene?.(char.id, item.id)}
        onGive={() => setPending({ itemId: item.id, ownerCharId: char.id, action: 'give' })}
        sceneActions={sceneImproveButton}
        targetPicker={isPendingThis ? (
          <TargetPicker
            party={party}
            action={pending.action}
            ownerCharId={char.id}
            onConfirm={confirm}
            onCancel={() => setPending(null)}
          />
        ) : undefined}
      />
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
        <img src={imgSrc('/images/icon_inventory.png')} alt="" className="w-6 h-6 object-contain mix-blend-screen rounded-lg" />
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
                    <img src={imgSrc(char.avatarUrl)} className={`w-5 h-5 rounded-full object-cover border ${isActive ? 'border-amber-500' : 'border-slate-600'} ${char.status === 'downed' ? 'grayscale opacity-40' : ''}`} alt={char.name} />
                    <span className={`text-[10px] font-black uppercase tracking-widest ${isActive ? 'text-amber-500' : 'text-slate-500'}`}>{char.name}{char.status === 'downed' ? ' · downed' : ''}{isActive ? ' · active' : ''}</span>
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
