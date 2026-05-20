import { useState } from 'react';
import type { Character, HpChange, InventoryChange, EncounterEnemyChange } from '../../types';
import { imgSrc } from '../../lib/api';
import { beatTarget } from '../../lib/game';
import { StatImg } from './StatIcon';
import { TtsButton } from '../TtsButton';
import type { TtsSettings } from '../../tts/ttsTypes';
import { STAT_COLORS } from '../../lib/statColors';
import { formatBuffBonusLabel, formatCharacterBonusLabel, formatChoiceItemBonusLabel, formatHelperBonusLabel } from './rollBonusLabels';
import { D20 } from './D20';
import { RollBreakdown } from './RollBreakdown';
import { getRollImpactOutcome } from '../../lib/rollOutcome';

interface LastSubmittedAction {
  label: string;
  stat: string;
  char: Character | null;
  difficulty: string;
  difficultyValue?: number;
  helperBonus?: number;
  helperCharacterName?: string;
  choiceItemBonus?: number;
  choiceItemName?: string;
  choiceItemOwnerName?: string;
  characterBonus?: number;
  characterBonusLabel?: string;
}

export interface RollResult {
  roll: number;
  success: boolean;
  stat: string;
  statBonus?: number;
  itemBonus?: number;
  helperBonus?: number;
  helperCharacterName?: string;
  choiceItemBonus?: number;
  choiceItemName?: string;
  choiceItemOwnerName?: string;
  characterBonus?: number;
  characterBonusLabel?: string;
  buffBonus?: number;
  buffBonusLabel?: string;
  impact?: 'normal' | 'strong' | 'extreme';
  isCritical?: boolean;
  difficultyTarget?: number;
  rollNarration?: string;
  hpChanges?: HpChange[];
  inventoryChanges?: InventoryChange[];
  encounterEnemyChanges?: EncounterEnemyChange[];
  encounterId?: string;
  encounterName?: string;
  encounterStatus?: string;
}

interface DmDecisionRecapPanelProps {
  lastSubmittedAction: LastSubmittedAction | null;
  ttsSettings: TtsSettings;
  rollResult?: RollResult | null;
  consequencesPending?: boolean;
}

const DM_FLAVOR_PHRASES = [
  'The DM is narrating...',
  'Fate is being decided...',
  'The dice are watching...',
  'The DM is pondering your doom...',
  'Destiny stirs in the shadows...',
  'The realm holds its breath...',
];

let phraseIdx = 0;
const pickPhrase = () => DM_FLAVOR_PHRASES[phraseIdx++ % DM_FLAVOR_PHRASES.length];

export const DmDecisionRecapPanel = ({ lastSubmittedAction, ttsSettings, rollResult, consequencesPending }: DmDecisionRecapPanelProps) => {
  const [flavorPhrase] = useState(pickPhrase);
  const char = lastSubmittedAction?.char ?? null;
  const stat = lastSubmittedAction?.stat ?? 'none';

  const statBase = char && stat !== 'none'
    ? char.stats[stat as keyof typeof char.stats] ?? 0
    : 0;
  const statBonus = char && stat !== 'none'
    ? char.inventory.reduce((s, item) => s + (item.statBonuses?.[stat as keyof typeof item.statBonuses] ?? 0), 0)
    : 0;
  const helperBonus = lastSubmittedAction?.helperBonus ?? 0;
  const choiceItemBonus = lastSubmittedAction?.choiceItemBonus ?? 0;
  const characterBonus = lastSubmittedAction?.characterBonus ?? 0;
  const buffBonus = char && stat !== 'none'
    ? (char.buffs ?? []).reduce((sum, buff) => sum + (buff.statBonuses?.[stat as keyof typeof buff.statBonuses] ?? 0), 0)
    : 0;
  const buffBonusLabel = char && buffBonus !== 0
    ? (char.buffs ?? [])
      .filter(b => (b.statBonuses?.[stat as keyof typeof b.statBonuses] ?? 0) !== 0)
      .map(b => b.name)
      .join(', ')
    : undefined;
  const statTotal = statBase + statBonus + helperBonus + choiceItemBonus + characterBonus + buffBonus;

  const minNeeded = lastSubmittedAction
    ? beatTarget(lastSubmittedAction.difficultyValue, lastSubmittedAction.difficulty)
    : 0;

  const rollOutcome = rollResult
    ? getRollImpactOutcome(rollResult.roll, rollResult.success, rollResult.impact)
    : null;

  return (
    <div className="relative flex flex-col min-h-[55vh] lg:h-full rounded-[32px] overflow-hidden animate-in fade-in zoom-in-95 duration-500">
      {/* Background */}
      <img
        src={imgSrc('/images/dm_thinking.png')}
        className="absolute inset-0 w-full h-full object-cover animate-ken-burns opacity-40"
        alt=""
      />
      <div className="absolute inset-0 bg-slate-950/70" />

      {rollResult ? (
        /* Roll result phase */
        <div className="relative z-10 flex flex-col items-center justify-start flex-1 gap-3 p-5 overflow-y-auto scrollbar-hide">
          {rollOutcome && (
            <div className={`relative overflow-hidden shrink-0 w-full flex flex-col items-center pt-2`}>
              <div className={`absolute inset-x-0 -top-8 h-24 blur-3xl ${rollOutcome.glowClass} opacity-60`} />
              <div className={`relative z-10 px-4 py-1.5 rounded-full border text-xs font-black uppercase tracking-[0.18em] ${rollOutcome.badgeClass}`}>
                <span>{rollOutcome.label}</span>
                <span className="mx-2 opacity-50">/</span>
                <span className="opacity-80">{rollOutcome.detail}</span>
              </div>
            </div>
          )}
          <D20 roll={rollResult.roll} success={rollResult.success} size={120} />
          <RollBreakdown
            roll={rollResult.roll}
            statBonus={rollResult.statBonus}
            itemBonus={rollResult.itemBonus}
            helperBonus={rollResult.helperBonus}
            helperCharacterName={rollResult.helperCharacterName}
            choiceItemBonus={rollResult.choiceItemBonus}
            choiceItemName={rollResult.choiceItemName}
            characterBonus={rollResult.characterBonus}
            characterBonusLabel={rollResult.characterBonusLabel}
            buffBonus={rollResult.buffBonus}
            buffBonusLabel={rollResult.buffBonusLabel}
            stat={rollResult.stat}
            success={rollResult.success}
            difficultyTarget={rollResult.difficultyTarget}
            className="text-sm"
          />
          {rollResult.rollNarration && (
            <p className="text-amber-100/90 text-center font-medium italic text-sm leading-snug max-w-xs animate-in slide-in-from-bottom-2 duration-700">
              {`🎲 ${rollResult.rollNarration}`}
            </p>
          )}
          {rollResult.encounterName && (
            <div className="shrink-0 rounded-full border border-rose-800/50 bg-rose-950/30 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-rose-300">
              Battle: {rollResult.encounterName}
              {rollResult.encounterStatus && rollResult.encounterStatus !== 'active' ? ` - ${rollResult.encounterStatus}` : ''}
            </div>
          )}
          {rollResult.hpChanges && rollResult.hpChanges.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-center animate-in slide-in-from-bottom-2 duration-500">
              {rollResult.hpChanges.map(hc => (
                <div
                  key={hc.characterId}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-widest border ${hc.change < 0 ? 'bg-rose-900/40 border-rose-700/50 text-rose-400' : 'bg-emerald-900/40 border-emerald-700/50 text-emerald-400'}`}
                >
                  <span>{hc.change < 0 ? '' : '+'}{hc.change}</span>
                  <span className="opacity-70 normal-case tracking-normal font-semibold">{hc.characterName.split(' ')[0]}</span>
                  <span className="opacity-50 text-[10px]">{hc.newHp}/{hc.maxHp}</span>
                </div>
              ))}
            </div>
          )}
          {rollResult.inventoryChanges && rollResult.inventoryChanges.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-center animate-in slide-in-from-bottom-2 duration-500">
              {rollResult.inventoryChanges.map((ic, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black border ${ic.type === 'added' ? 'bg-amber-900/40 border-amber-700/50 text-amber-400' : ic.type === 'updated' ? 'bg-indigo-900/40 border-indigo-700/50 text-indigo-300' : 'bg-slate-800/60 border-slate-700/50 text-slate-400'}`}
                >
                  <span>{ic.type === 'added' ? '＋' : ic.type === 'updated' ? '✦' : '－'}</span>
                  <span className="normal-case tracking-normal font-semibold">{ic.itemName}</span>
                  <span className="opacity-60">→ {ic.characterName.split(' ')[0]}</span>
                </div>
              ))}
            </div>
          )}
          {rollResult.encounterEnemyChanges && rollResult.encounterEnemyChanges.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-center animate-in slide-in-from-bottom-2 duration-500">
              {rollResult.encounterEnemyChanges.map((ec, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black border ${ec.newStatus && ec.newStatus !== 'active' ? 'bg-rose-950/60 border-rose-700/70 text-rose-300' : 'bg-orange-900/40 border-orange-700/50 text-orange-300'}`}
                >
                  {ec.hpChange !== 0 && <span>{ec.hpChange < 0 ? '-' : '+'}{Math.abs(ec.hpChange)}</span>}
                  <span className="normal-case tracking-normal font-semibold">{ec.enemyName.split(' ')[0]}</span>
                  {ec.newStatus && ec.newStatus !== 'active' && <span className="opacity-70 uppercase">{ec.newStatus}</span>}
                </div>
              ))}
            </div>
          )}
          {consequencesPending && (
            <div className="flex items-center gap-2 text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1 shrink-0">
              <div className="w-3 h-3 border-2 border-slate-600 border-t-amber-500 rounded-full animate-spin shrink-0" />
              Loading consequences...
            </div>
          )}
        </div>
      ) : (
        /* Narrating phase */
        <div className="relative z-10 flex flex-col items-center justify-center flex-1 gap-4 p-6 text-center">
          <img
            src={imgSrc('/images/icon_dice.png')}
            className="w-28 h-28 rounded-full object-cover animate-dice-spin"
            alt="Rolling dice"
          />
          <div className="text-amber-500 font-black uppercase tracking-widest text-lg animate-pulse">
            {flavorPhrase}
          </div>
          {lastSubmittedAction && (
            <div className="flex flex-col items-center gap-3 w-full max-w-xs">
              {char && (
                <div className="flex items-center gap-2">
                  <img
                    src={imgSrc(char.avatarUrl)}
                    className="w-10 h-10 rounded-full object-cover border border-slate-600"
                    alt={char.name}
                  />
                  <span className="text-sm font-black uppercase tracking-widest text-slate-400">
                    {char.name}
                  </span>
                </div>
              )}
              <div className="px-4 py-3 bg-slate-900/60 border border-slate-700 rounded-2xl w-full">
                <p className="font-narrative italic text-slate-200 text-base leading-snug">
                  "{lastSubmittedAction.label}"
                </p>
                <TtsButton text={lastSubmittedAction.label} ttsSettings={ttsSettings} className="justify-center mt-2" />
              </div>
              {stat !== 'none' && char && (
                <div className="flex flex-col items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-black uppercase tracking-widest ${STAT_COLORS[stat] ?? STAT_COLORS.none}`}>
                    <StatImg stat={stat} size="6" />
                    {stat}
                  </span>
                  <div className="flex items-center gap-3 text-base font-black">
                    <span className="text-slate-300">
                      {statBase}{statBonus !== 0 && (
                        <span className={statBonus > 0 ? 'text-amber-400' : 'text-rose-400'}>
                          {statBonus > 0 ? `+${statBonus}` : statBonus}
                        </span>
                      )}
                      {helperBonus > 0 && <span className="text-cyan-300">+{helperBonus}</span>}
                      {choiceItemBonus > 0 && <span className="text-amber-300">+{choiceItemBonus}</span>}
                      {characterBonus > 0 && <span className="text-fuchsia-300">+{characterBonus}</span>}
                      {buffBonus > 0 && <span className="text-violet-300">+{buffBonus}</span>}
                      {buffBonus < 0 && <span className="text-rose-300">{buffBonus}</span>}
                      {' '}= {statTotal}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-400">Need ≥ {minNeeded}</span>
                  </div>
                  {(helperBonus > 0 || choiceItemBonus > 0 || characterBonus > 0 || buffBonus !== 0) && (
                    <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-black">
                      {helperBonus > 0 && (
                        <span className="text-cyan-300">+{formatHelperBonusLabel(helperBonus, lastSubmittedAction.helperCharacterName)}</span>
                      )}
                      {choiceItemBonus > 0 && (
                        <span className="text-amber-300">+{formatChoiceItemBonusLabel(choiceItemBonus, lastSubmittedAction.choiceItemName)}</span>
                      )}
                      {characterBonus > 0 && (
                        <span className="text-fuchsia-300">+{formatCharacterBonusLabel(characterBonus, lastSubmittedAction.characterBonusLabel)}</span>
                      )}
                      {buffBonus !== 0 && (
                        <span className={buffBonus > 0 ? 'text-violet-300' : 'text-rose-300'}>{buffBonus > 0 ? '+' : ''}{formatBuffBonusLabel(buffBonus, buffBonusLabel)}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
