import { useState, useRef, useEffect } from 'react';
import type { TurnResult, Character, InventoryItem } from '../../types';
import { apiFetch, imgSrc, pulseSyncDelay } from '../../lib/api';
import { beatTarget } from '../../lib/game';
import { StatIcon, StatImg } from './StatIcon';
import { STAT_COLORS } from '../../lib/statColors';
import { TargetPicker } from './TargetPicker';
import { getHpColors } from '../../lib/hpColors';
import { useTtsSettings } from '../../tts/useTtsSettings';
import { browserTtsService } from '../../tts/browserTtsService';

interface ActionDockProps {
  turn: TurnResult | null;
  loading: boolean;
  activeCharacter: Character | null;
  isDown: boolean | undefined;
  party: Character[];
  sessionId: string;
  customAction: string;
  setCustomAction: (v: string) => void;
  error: string | null;
  onSubmit: (label: string, stat: string, diff: string, difficultyValue?: number) => void;
  onUseItem: (ownerCharId: string, itemId: string, targetCharId: string) => void;
  onGiveItem: (ownerCharId: string, itemId: string, targetCharId: string) => void;
  onShowPartyGear: () => void;
  partyItemCount: number;
}

const RISK_MAP: Record<string, { label: string; color: string }> = {
  easy: { label: 'Favorable', color: 'text-emerald-400' },
  normal: { label: 'Risky', color: 'text-amber-400' },
  hard: { label: 'Tough', color: 'text-rose-400' },
};

const calcProb = (statTotal: number, target: number) => {
  const minNeeded = Math.max(1, Math.min(20, target - statTotal));
  return Math.round(((21 - minNeeded) / 20) * 100);
};

// All items for active character, stacked top-down, shared pending state
const ItemsSection = ({
  items,
  char,
  party,
  disabled,
  onUseItem,
  onGiveItem,
  onShowPartyGear,
  partyItemCount,
}: {
  items: InventoryItem[];
  char: Character;
  party: Character[];
  disabled: boolean;
  onUseItem: (ownerCharId: string, itemId: string, targetCharId: string) => void;
  onGiveItem: (ownerCharId: string, itemId: string, targetCharId: string) => void;
  onShowPartyGear: () => void;
  partyItemCount: number;
}) => {
  const [pending, setPending] = useState<{ itemId: string; action: 'use' | 'give' } | null>(null);

  const confirm = (targetCharId: string) => {
    if (!pending) {
      return;
    }
    if (pending.action === 'use') {
      onUseItem(char.id, pending.itemId, targetCharId);
    } else {
      onGiveItem(char.id, pending.itemId, targetCharId);
    }
    setPending(null);
  };

  const otherPartyMembers = party.filter(c => c.id !== char.id);

  return (
    <div className="relative flex flex-col gap-1.5 p-3 bg-slate-800/50 rounded-2xl border border-slate-700/50">
      <img src={imgSrc('/images/icon_inventory.png')} alt="" className="absolute top-2 right-2 w-18 h-18 rounded-lg object-contain mix-blend-screen pointer-events-none" />
      <div className="mb-1">
        <span className="text-base font-black uppercase tracking-wide text-slate-400">Items</span>
      </div>

      {items.map(item => {
        const canUse = (item.healValue ?? 0) > 0;
        const canGive = !!item.transferable && otherPartyMembers.length > 0;
        const isPending = pending?.itemId === item.id;
        const bonuses = item.statBonuses ? Object.entries(item.statBonuses).filter(([, v]) => v && v > 0) : [];

        return (
          <div key={item.id} className={`flex flex-col gap-1.5 px-3 py-2 rounded-xl border transition-colors ${isPending ? 'border-amber-500/40 bg-amber-950/10' : 'border-slate-700/40 bg-slate-900/40'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-black text-xs uppercase tracking-wide text-slate-200 truncate">{item.name}</div>
                <div className="text-xs text-slate-500 mt-0.5 leading-snug line-clamp-1">{item.description}</div>
              </div>
              {((item.healValue ?? 0) > 0 || bonuses.length > 0) && (
                <div className="flex gap-1 shrink-0">
                  {(item.healValue ?? 0) > 0 && (
                    <span className="text-xs font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">+{item.healValue} hp</span>
                  )}
                  {bonuses.map(([stat, val]) => (
                    <span key={stat} className="text-xs font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">+{val} {stat}</span>
                  ))}
                </div>
              )}
            </div>

            {isPending ? (
              <TargetPicker
                compact
                party={party}
                action={pending.action}
                ownerCharId={char.id}
                onConfirm={confirm}
                onCancel={() => setPending(null)}
              />
            ) : (
              (canUse || canGive) && !disabled && (
                <div className="flex items-center gap-1.5">
                  {canUse && (
                    <button
                      onClick={() => setPending({ itemId: item.id, action: 'use' })}
                      className="px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-widest bg-emerald-900/60 text-emerald-400 hover:bg-emerald-800/60 border border-emerald-700/40 transition-all"
                    >
                      Use
                    </button>
                  )}
                  {canGive && (
                    <button
                      onClick={() => setPending({ itemId: item.id, action: 'give' })}
                      className="px-2.5 py-1 rounded-lg text-xs font-black uppercase tracking-widest bg-blue-900/60 text-blue-400 hover:bg-blue-800/60 border border-blue-700/40 transition-all"
                    >
                      Give
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        );
      })}

      {/* Party gear access */}
      {partyItemCount > items.length && (
        <button
          onClick={onShowPartyGear}
          className="mt-0.5 text-left"
        >
          <span className="inline-block px-3 py-1.5 rounded-xl border border-slate-700 text-slate-400 hover:text-amber-400 hover:border-amber-500/40 text-xs font-black uppercase tracking-widest transition-all">
            Party Gear ({partyItemCount - items.length} more)
          </span>
        </button>
      )}
    </div>
  );
};

export const ActionDock = ({
  turn,
  loading,
  activeCharacter,
  isDown,
  party,
  sessionId,
  customAction,
  setCustomAction,
  error,
  onSubmit,
  onUseItem,
  onGiveItem,
  onShowPartyGear,
  partyItemCount,
}: ActionDockProps) => {
  const [statThinking, setStatThinking] = useState(false);
  const choiceButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { settings: ttsSettings } = useTtsSettings();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inTextField = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT';

      if (inTextField) {
        if (e.key === 'Escape') {
          target.blur();
        }
        return;
      }

      if (loading || isDown) {
        return;
      }

      const choices = turn?.choices ?? [];
      if (e.key === '1' && choices[0]) {
        choiceButtonRefs.current[0]?.focus();
      } else if (e.key === '2' && choices[1]) {
        choiceButtonRefs.current[1]?.focus();
      } else if (e.key === '3' && choices[2]) {
        choiceButtonRefs.current[2]?.focus();
      } else if (e.key === '4') {
        e.preventDefault();
        textareaRef.current?.focus();
      } else if (e.key === 'i') {
        onShowPartyGear();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loading, isDown, turn, onShowPartyGear]);
  const ttsEnabled = ttsSettings.enabled && browserTtsService.isSupported();

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
        body: JSON.stringify({
          action: customAction,
          characterClass: activeCharacter?.class,
          characterQuirk: activeCharacter?.quirk,
        }),
      });
      if (res.ok) {
        ({ stat } = await res.json());
      }
    } catch { /* fallback to mischief */ }
    setStatThinking(false);
    onSubmit(customAction, stat, 'normal');
  };

  const activeItems = activeCharacter?.inventory ?? [];

  return (
    <div className="flex flex-col gap-3 h-full p-4 bg-slate-900 rounded-[32px] border border-slate-800 overflow-y-auto scrollbar-hide">
      {error && (
        <div className="px-4 py-2 bg-rose-950/60 border border-rose-700 rounded-xl text-rose-300 text-xs font-black uppercase tracking-widest">
          {error}
        </div>
      )}

      {/* Active hero panel */}
      {activeCharacter && (
        <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-2xl border border-slate-700/50">
          <img
            src={imgSrc(activeCharacter.avatarUrl)}
            className="w-16 h-16 rounded-2xl object-cover border-2 border-amber-500 animate-border-pulse shrink-0"
            style={{ animationDelay: pulseSyncDelay() }}
            alt={activeCharacter.name}
          />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-base uppercase tracking-wide truncate">{activeCharacter.name}</span>
              <span className={`text-xs font-black shrink-0 ${getHpColors(activeCharacter.hp, activeCharacter.max_hp).text}`}>
                {activeCharacter.hp}/{activeCharacter.max_hp} HP
              </span>
            </div>
            <div className="text-xs text-slate-400 uppercase tracking-wide truncate">
              {activeCharacter.class} · {activeCharacter.species}
            </div>
            {/* HP bar */}
            <div className="h-1 rounded-full bg-slate-700 w-full mt-0.5">
              <div
                className={`h-1 rounded-full transition-all ${getHpColors(activeCharacter.hp, activeCharacter.max_hp).bar}`}
                style={{ width: `${Math.max(0, (activeCharacter.hp / activeCharacter.max_hp) * 100)}%` }}
              />
            </div>
            {/* Stats */}
            <div className="flex gap-4 mt-1">
              {(['might', 'magic', 'mischief'] as const).map(stat => (
                <StatIcon
                  key={stat}
                  stat={stat}
                  base={activeCharacter.stats[stat]}
                  bonus={activeCharacter.inventory.reduce((s, item) => s + (item.statBonuses?.[stat] ?? 0), 0)}
                  className="text-sm"
                  iconSize="12"
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Items panel - all active character items */}
      {(activeItems.length > 0 || partyItemCount > 0) && activeCharacter && (
        <ItemsSection
          items={activeItems}
          char={activeCharacter}
          party={party}
          disabled={loading}
          onUseItem={onUseItem}
          onGiveItem={onGiveItem}
          onShowPartyGear={onShowPartyGear}
          partyItemCount={partyItemCount}
        />
      )}

      {/* Downed state OR action area */}
      {isDown ? (
        <div className="flex flex-col items-center justify-center gap-3 py-8 px-6 bg-slate-800/30 rounded-2xl border border-slate-700/50 text-center">
          {activeCharacter && (
            <img src={imgSrc(activeCharacter.avatarUrl)} className="w-12 h-12 rounded-full object-cover grayscale opacity-50 border-2 border-slate-700" alt="" />
          )}
          <div className="font-black text-sm uppercase tracking-widest text-slate-400">
            {activeCharacter?.name} is downed
          </div>
          <p className="text-slate-500 text-xs">
            {party.every(c => c.status === 'downed')
              ? 'The whole party is down...'
              : 'Another party member needs to use a healing item.'}
          </p>
        </div>
      ) : (
        <>
          {/* Action cards */}
          {turn?.choices && turn.choices.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-black uppercase tracking-widest text-slate-500 px-1">Choose an Action</div>
              {turn.choices.map((choice, i) => {
                const risk = RISK_MAP[choice.difficulty] ?? RISK_MAP.normal;
                const statTotal = activeCharacter
                  ? activeCharacter.stats[choice.stat as keyof typeof activeCharacter.stats] +
                    activeCharacter.inventory.reduce((s, item) => s + (item.statBonuses?.[choice.stat as keyof typeof item.statBonuses] ?? 0), 0)
                  : 0;
                const target = beatTarget(choice.difficultyValue, choice.difficulty);
                const prob = calcProb(statTotal, target);

                return (
                  <button
                    key={i}
                    ref={el => {
                      choiceButtonRefs.current[i] = el;
                    }}
                    onClick={() => onSubmit(choice.label, choice.stat, choice.difficulty, choice.difficultyValue)}
                    disabled={loading}
                    className={`w-full p-3 rounded-2xl border-2 text-left transition-all hover:brightness-110 disabled:opacity-50 ${STAT_COLORS[choice.stat]}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-black text-base xl:text-lg uppercase leading-tight flex-1">{choice.label}</div>
                      {ttsEnabled && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            const text = choice.narration ? `${choice.label}. ${choice.narration}` : choice.label;
                            browserTtsService.speakNarration(text, ttsSettings);
                          }}
                          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 text-sm transition-colors"
                          aria-label="Read aloud"
                        >
                          🔊
                        </button>
                      )}
                    </div>
                    {choice.narration && (
                      <div className="text-xs italic text-slate-300/70 mt-0.5 leading-snug">{choice.narration}</div>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <StatImg stat={choice.stat} size="12" tooltip className="rounded-xl" />
                      <span className="text-xs text-slate-400 font-black">
                        {statTotal} vs {target}
                      </span>
                      <span className={`text-xs font-black uppercase tracking-widest ${risk.color}`}>{risk.label}</span>
                      <span className="text-xs text-slate-500 font-black ml-auto">{prob}%</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Command bar + UNLEASH */}
          <div className="flex flex-col gap-2 pt-1">
            <textarea
              ref={textareaRef}
              value={customAction}
              onChange={e => setCustomAction(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitCustom();
                }
              }}
              rows={2}
              placeholder="Describe a different action..."
              disabled={loading || statThinking}
              className="w-full p-3 bg-slate-800 rounded-xl resize-none text-sm border border-slate-700 focus:border-amber-500/40 outline-none transition-colors placeholder-slate-600"
            />
            <button
              onClick={submitCustom}
              disabled={loading || statThinking || !customAction.trim()}
              className="w-full py-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 rounded-2xl font-black uppercase tracking-tighter text-xl xl:text-2xl shadow-[0_6px_0_rgb(146,64,14)] transition-all italic"
            >
              {statThinking ? '...' : 'UNLEASH'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
