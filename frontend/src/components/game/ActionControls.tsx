import { useState } from 'react';
import type { TurnResult, Choice, Character } from '../../types';
import { apiFetch, imgSrc, pulseSyncDelay } from '../../lib/api';
import { beatTarget } from '../../lib/game';
import { StatIcon } from './StatIcon';
import { Inventory } from './Inventory';

interface ActionControlsProps {
  turn: TurnResult | null;
  loading: boolean;
  onSubmit: (label: string, stat: string, diff: string, difficultyValue?: number) => void;
  customAction: string;
  setCustomAction: (action: string) => void;
  activeCharacter: Character | null;
  sessionId: string;
  error: string | null;
  disabled: boolean;
  // Inventory
  party?: Character[];
  activeCharacterId?: string;
  onUseItem?: (ownerCharId: string, itemId: string, targetCharId: string) => void;
  onGiveItem?: (ownerCharId: string, itemId: string, targetCharId: string) => void;
  inventoryDisabled?: boolean;
  onShowPartyGear?: () => void;
  partyItemCount?: number;
}

const STAT_COLORS: Record<string, string> = {
  might: 'border-rose-500 bg-rose-950/30 text-rose-200',
  magic: 'border-blue-500 bg-blue-950/30 text-blue-200',
  mischief: 'border-purple-500 bg-purple-950/30 text-purple-200',
  none: 'border-slate-500 bg-slate-900 text-slate-200'
};

const DIFF_COLORS: Record<string, string> = {
  easy: 'shadow-[inset_0_0_10px_rgba(34,197,94,0.3)]',
  normal: 'shadow-[inset_0_0_10px_rgba(245,158,11,0.3)]',
  hard: 'shadow-[inset_0_0_10px_rgba(239,68,68,0.3)]'
};

export const ActionControls = ({
  turn, loading, onSubmit, customAction, setCustomAction, activeCharacter, sessionId, error, disabled,
  party, activeCharacterId, onUseItem, onGiveItem, inventoryDisabled, onShowPartyGear, partyItemCount
}: ActionControlsProps) => {
  const [statThinking, setStatThinking] = useState(false);

  const submitCustom = async () => {
    if (!customAction.trim() || loading) {
      return;
    }
    setStatThinking(true);
    let stat = 'mischief';
    try {
      const res = await apiFetch(`/session/${sessionId}/suggest-stat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: customAction, characterClass: activeCharacter?.class, characterQuirk: activeCharacter?.quirk }),
      });
      if (res.ok) {
        ({ stat } = await res.json());
      }
    } catch { /* fallback */ }
    setStatThinking(false);
    onSubmit(customAction, stat, 'normal');
  };

  const hasInventory = !!(onUseItem || onGiveItem);
  const activeItems = activeCharacter?.inventory ?? [];
  const showInventory = hasInventory && (activeItems.length > 0 || (partyItemCount ?? 0) > 0);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 bg-slate-900/50 rounded-[40px] border border-slate-800">
      {error && <div className="text-red-400 text-xs font-black uppercase tracking-widest">{error}</div>}
      {/* Character row: avatar + name + stats + inventory inline */}
      <div className="flex items-start gap-3 xl:gap-5 flex-wrap">
        <img src={imgSrc(activeCharacter?.avatarUrl)} className="w-12 h-12 xl:w-20 xl:h-20 rounded-2xl xl:rounded-3xl object-cover border-2 border-amber-500 animate-border-pulse shrink-0" style={{ animationDelay: pulseSyncDelay() }} />
        {activeCharacter && (
          <div className="flex items-start gap-4 xl:gap-6 flex-1 min-w-0 flex-wrap xl:justify-between">
            <div className="flex flex-col gap-0.5 xl:gap-1 min-w-0">
              <div className="font-black text-xs xl:text-lg uppercase tracking-widest truncate">{activeCharacter.name}</div>
              <div className="text-[9px] xl:text-xs text-slate-400 uppercase tracking-wide truncate">{activeCharacter.class} · {activeCharacter.species}</div>
            </div>
            <div className="flex flex-col gap-1 xl:gap-2 shrink-0">
              <div className="text-xs xl:text-xl text-amber-500 font-black">{activeCharacter.hp}/{activeCharacter.max_hp} HP</div>
              <div className="flex gap-2 xl:gap-4">
                {(['might', 'magic', 'mischief'] as const).map(stat => (
                  <StatIcon
                    key={stat}
                    stat={stat}
                    base={activeCharacter.stats[stat]}
                    bonus={activeCharacter.inventory.reduce((s, item) => s + (item.statBonuses?.[stat] ?? 0), 0)}
                    className="xl:text-lg"
                  />
                ))}
              </div>
            </div>
            {/* Compact inventory: flows inline after stats */}
            {showInventory && party && (
              <div className="flex flex-col items-end gap-1 shrink-0">
                {activeItems.length > 0 && (
                  <Inventory
                    party={party}
                    activeCharacterId={activeCharacterId}
                    onUseItem={onUseItem}
                    onGiveItem={onGiveItem}
                    disabled={inventoryDisabled}
                    filterCharId={activeCharacter.id}
                    compact
                  />
                )}
                {(partyItemCount ?? 0) > 0 && (
                  <button
                    onClick={onShowPartyGear}
                    className="mt-0.5 px-2 py-1 rounded-lg border border-slate-700 text-slate-400 hover:text-amber-400 hover:border-amber-500/40 text-[8px] xl:text-[10px] font-black uppercase tracking-widest transition-all"
                  >
                    Party Gear ({partyItemCount})
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Choices + custom input: side by side on xl screens, stacked otherwise */}
      <div className="flex flex-col xl:flex-row xl:items-stretch gap-3">
        {/* Choices: stacked on xl, grid on smaller */}
        <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-1 xl:flex-1 gap-3 min-w-0">
          {turn?.choices.map((choice: Choice, i: number) => (
            <button
              key={i}
              onClick={() => onSubmit(choice.label, choice.stat, choice.difficulty, choice.difficultyValue)}
              disabled={loading}
              className={`w-full min-w-0 overflow-hidden p-4 rounded-2xl border-2 text-base font-black uppercase transition-all flex flex-col items-center justify-between min-h-[80px]
                  ${STAT_COLORS[choice.stat]} ${DIFF_COLORS[choice.difficulty]} hover:brightness-110 disabled:opacity-50`}
            >
              <span className="leading-tight text-center break-words w-full">{choice.label}</span>
              <span className={`text-[9px] font-black tracking-widest px-2 py-0.5 rounded-full opacity-80 mt-1 shrink-0
                  ${choice.stat === 'might' ? 'bg-rose-900/60' : choice.stat === 'magic' ? 'bg-blue-900/60' : 'bg-purple-900/60'}`}>
                {choice.stat} · {choice.difficulty} (&gt;{beatTarget(choice.difficultyValue, choice.difficulty)})
              </span>
            </button>
          ))}
        </div>

        {/* Custom action: on xl, textarea stretches to fill height, button pins to bottom */}
        <div className="flex xl:flex-1 xl:flex-col gap-3">
          <textarea
            value={customAction}
            onChange={(e) => setCustomAction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitCustom();
              }
            }}
            rows={1}
            className="flex-1 xl:flex-1 min-w-0 p-4 bg-slate-800 rounded-xl resize-none"
            placeholder="What do you do?"
            disabled={disabled || loading || statThinking}
          />
          <button
            onClick={submitCustom}
            disabled={disabled || loading || statThinking || !(customAction || '').trim()}
            className="shrink-0 px-6 py-4 bg-amber-600 rounded-xl font-black uppercase disabled:opacity-50 min-w-[100px]"
          >
            {statThinking ? '...' : 'UNLEASH'}
          </button>
        </div>
      </div>
    </div>
  );
};
