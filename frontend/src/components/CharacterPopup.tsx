import { useEffect, useState, useRef } from 'react';
import type { Character } from '../types';
import { imgSrc } from '../lib/api';
import { StatImg } from './game/StatIcon';
import { InventoryItemCard } from './game/Inventory';
import { Modal } from './Modal';
import { getHpColors } from '../lib/hpColors';
import { STAT_TEXT_COLORS } from '../lib/statColors';

interface CharacterPopupProps {
  character: Character;
  activeCharacter?: Character | null;
  onClose: () => void;
  onAvatarClick: (url: string) => void;
  onBlessCharacter?: (targetCharacterId: string) => void;
  onAidCharacter?: (targetCharacterId: string) => void;
  previewThinking?: boolean;
}

const STAT_META = [
  { key: 'might' as const, label: 'Might', color: 'text-rose-400', bg: 'bg-rose-500', track: 'bg-rose-950' },
  { key: 'magic' as const, label: 'Magic', color: 'text-blue-400', bg: 'bg-blue-500', track: 'bg-blue-950' },
  { key: 'mischief' as const, label: 'Mischief', color: 'text-purple-400', bg: 'bg-purple-500', track: 'bg-purple-950' },
];

const formatBuffSummary = (buff: NonNullable<Character['buffs']>[number]): string => {
  const statBonus = (['might', 'magic', 'mischief'] as const)
    .map(stat => ({ stat, value: buff.statBonuses?.[stat] ?? 0 }))
    .find(({ value }) => value !== 0);
  const bonusLabel = statBonus
    ? ` ${statBonus.value > 0 ? '+' : ''}${statBonus.value} ${statBonus.stat[0].toUpperCase()}${statBonus.stat.slice(1)}`
    : '';
  const durationLabel = buff.remainingUses != null
    ? ` · ${buff.remainingUses} use${buff.remainingUses === 1 ? '' : 's'}`
    : buff.remainingTurns != null
      ? ` · ${buff.remainingTurns} turn${buff.remainingTurns === 1 ? '' : 's'}`
      : '';
  return `${buff.name}${bonusLabel}${durationLabel}`;
};

export const CharacterPopup = ({ character, activeCharacter, onClose, onAvatarClick, onBlessCharacter, onAidCharacter, previewThinking }: CharacterPopupProps) => {
  const [expandedStat, setExpandedStat] = useState<'might' | 'magic' | 'mischief' | null>(null);
  const firstSupportButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Auto-focus the first available support button if it exists
    if (firstSupportButtonRef.current) {
      firstSupportButtonRef.current.focus();
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const hpPct = Math.max(0, Math.min(100, (character.hp / character.max_hp) * 100));
  const { bar: hpColor } = getHpColors(character.hp, character.max_hp);
  const buffs = character.buffs ?? [];
  const canTargetWithSupport = !!activeCharacter &&
    activeCharacter.id !== character.id &&
    activeCharacter.status !== 'downed' &&
    character.status !== 'downed' &&
    (!!onBlessCharacter || !!onAidCharacter);

  return (
    <Modal className="animate-in fade-in duration-300">
      <div role="dialog" aria-modal="true" aria-label={`${character.name} character details`} className="bg-slate-900 p-6 md:p-10 rounded-[40px] border-2 border-amber-500/30 shadow-2xl max-w-lg w-full relative">
        <button onClick={onClose} aria-label="Close" className="absolute top-6 right-6 text-slate-500 hover:text-white">✕</button>

        {/* Header */}
        <div className="flex gap-4 md:gap-6 mb-6">
          <img
            src={imgSrc(character.avatarUrl)}
            onClick={() => onAvatarClick(imgSrc(character.avatarUrl))}
            className={`w-24 h-24 md:w-32 md:h-32 rounded-2xl object-cover cursor-zoom-in shrink-0 ${character.status === 'downed' ? 'grayscale opacity-60' : ''}`}
            alt={character.name}
          />
          <div className="flex-1 min-w-0">
            <h3 className="text-2xl md:text-3xl font-black text-white truncate">{character.name}</h3>
            <p className="text-amber-500 text-base">{character.species} · {character.class}</p>
            <p className="text-sm text-slate-400 mt-1 italic">"{character.quirk}"</p>
            {/* HP bar */}
            <div className="mt-3">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">HP</span>
                <span className={`text-xs font-black ${character.status === 'downed' ? 'text-rose-400' : 'text-slate-300'}`}>
                  {character.status === 'downed' ? 'DOWNED' : `${character.hp} / ${character.max_hp}`}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${hpColor}`} style={{ width: `${hpPct}%` }} />
              </div>
            </div>
          </div>
        </div>

        {buffs.length > 0 && (
          <div className="mb-6">
            <h4 className="text-xs font-black uppercase tracking-widest text-slate-600 mb-3">Effects</h4>
            <div className="flex flex-wrap gap-2">
              {buffs.map(buff => (
                <span key={buff.id} className={`px-2.5 py-1 rounded-full border text-[11px] font-black ${buff.kind === 'curse' ? 'bg-rose-950/60 border-rose-500/30 text-rose-200' : 'bg-emerald-950/60 border-emerald-500/30 text-emerald-200'}`}>
                  {formatBuffSummary(buff)}
                </span>
              ))}
            </div>
          </div>
        )}

        {canTargetWithSupport && (
          <div className="mb-6 flex flex-wrap gap-2">
            {onBlessCharacter && (
              <button
                type="button"
                ref={firstSupportButtonRef}
                onClick={() => onBlessCharacter(character.id)}
                disabled={previewThinking}
                className="px-3 py-2 rounded-xl border border-blue-700/50 bg-blue-950/40 text-blue-200 text-xs font-black uppercase tracking-widest hover:bg-blue-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {previewThinking ? 'Thinking...' : 'Bless'}
              </button>
            )}
            {onAidCharacter && (
              <button
                type="button"
                ref={!onBlessCharacter ? firstSupportButtonRef : undefined}
                onClick={() => onAidCharacter(character.id)}
                disabled={previewThinking}
                className="px-3 py-2 rounded-xl border border-emerald-700/50 bg-emerald-950/40 text-emerald-200 text-xs font-black uppercase tracking-widest hover:bg-emerald-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {previewThinking ? 'Thinking...' : 'Aid'}
              </button>
            )}
          </div>
        )}

        {/* Stats */}
        <h4 className="text-xs font-black uppercase tracking-widest text-slate-600 mb-3">Stats</h4>
        <div className="grid grid-cols-3 gap-2 mb-6">
          {STAT_META.map(({ key, label, color, bg, track }) => {
            const base = character.stats[key];
            const bonusItems = character.inventory.filter(item => (item.statBonuses?.[key] ?? 0) > 0);
            const effectBuffs = buffs.filter(buff => (buff.statBonuses?.[key] ?? 0) !== 0);
            const itemBonus = bonusItems.reduce((s, item) => s + (item.statBonuses![key]!), 0);
            const effectModifier = Math.min(3, Math.max(-3, effectBuffs.reduce((s, buff) => s + (buff.statBonuses![key]!), 0)));
            const modifier = itemBonus + effectModifier;
            const total = base + modifier;
            const hasModifier = modifier !== 0;
            const isOpen = expandedStat === key;
            const barPct = Math.max(0, Math.min(100, (total / 10) * 100));
            return (
              <div key={key} className={`p-3 rounded-2xl ${track}/40 border border-slate-800`}>
                <button
                  type="button"
                  disabled={!hasModifier}
                  onClick={() => setExpandedStat(stat => stat === key ? null : key)}
                  className={`w-full text-left ${hasModifier ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-300 rounded' : 'cursor-default'}`}
                  aria-expanded={hasModifier ? isOpen : undefined}
                >
                  <div className="flex items-center gap-1 mb-1">
                    <StatImg stat={key} size="8" />
                    <span className={`text-[10px] font-black uppercase tracking-widest ${color}`}>{label}</span>
                    {hasModifier && (
                      <span className={`ml-auto text-[10px] text-amber-500/70 leading-none transition-transform duration-150 inline-block ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-2xl font-black tabular-nums ${hasModifier ? (modifier > 0 ? 'text-amber-400' : 'text-rose-300') : STAT_TEXT_COLORS[key]}`}>{total}</span>
                    {hasModifier && (
                      <span className={`text-xs font-black ${modifier > 0 ? 'text-amber-500/70' : 'text-rose-300/80'}`}>{modifier > 0 ? '+' : ''}{modifier}</span>
                    )}
                  </div>
                </button>
                <div className="h-1.5 rounded-full bg-slate-800 mt-2 overflow-hidden">
                  <div className={`h-full rounded-full ${bg}`} style={{ width: `${barPct}%` }} />
                </div>
                {hasModifier && isOpen && (
                  <div className="mt-2 flex flex-col gap-0.5 px-2 py-1.5 rounded-lg bg-slate-800/60 text-xs border border-slate-700/50">
                    <div className="text-slate-400">{base} base</div>
                    {bonusItems.map(item => (
                      <div key={item.id} className="text-amber-400">+{item.statBonuses![key]} {item.name}</div>
                    ))}
                    {effectBuffs.map(buff => (
                      <div key={buff.id} className={buff.kind === 'curse' ? 'text-rose-300' : 'text-emerald-300'}>{buff.statBonuses![key]! > 0 ? '+' : ''}{buff.statBonuses![key]} {buff.name}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Inventory */}
        <h4 className="text-xs font-black uppercase tracking-widest text-slate-600 mb-3">Inventory</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(character.inventory || []).length === 0 ? (
            <p className="text-slate-600 text-sm italic">Empty pockets...</p>
          ) : (character.inventory || []).map((item, i) => (
            <InventoryItemCard key={item.id ?? i} item={item} />
          ))}
        </div>
      </div>
    </Modal>
  );
};
