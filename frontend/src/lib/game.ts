import type { Character, Choice } from '../types';

export const DIFF_THRESHOLDS: Record<string, number> = { easy: 8, normal: 12, hard: 16 };

export const beatTarget = (difficultyValue: number | undefined, difficulty: string): number =>
  difficultyValue ?? DIFF_THRESHOLDS[difficulty] ?? 12;

export const RISK_LABELS: Record<string, string> = { easy: 'Favorable', normal: 'Risky', hard: 'Tough' };

export const COMBO_HELPER_BONUS = 2;
export const CHOICE_ITEM_BONUS = 2;
export const CHARACTER_EDGE_BONUS = 2;

export const calcSuccessProb = (statTotal: number, target: number): number => {
  const minNeeded = Math.max(1, Math.min(20, target - statTotal));
  return Math.round(((21 - minNeeded) / 20) * 100);
};

export type ChoiceOdds = {
  statBase: number;
  statBonus: number;
  buffBonus: number;
  helperBonus: number;
  choiceItemBonus: number;
  characterBonus: number;
  characterBonusLabel: string;
  statTotal: number;
  target: number;
  prob: number;
  riskLabel: string;
  isRiddleAnswer: boolean;
};

// Single source of truth for per-choice roll odds, shared by the ActionDock,
// terminal mode, and car mode so every surface shows the same numbers.
export function computeChoiceOdds(choice: Choice, activeCharacter: Character | null | undefined, party: Character[]): ChoiceOdds {
  const choiceStat = choice.stat as 'might' | 'magic' | 'mischief';
  const statBase = activeCharacter?.stats[choiceStat] ?? 0;
  const statBonus = activeCharacter?.inventory.reduce((s, item) => s + (item.statBonuses?.[choiceStat] ?? 0), 0) ?? 0;
  const rawBuffBonus = (activeCharacter?.buffs ?? []).reduce((s, buff) => s + (buff.statBonuses?.[choiceStat] ?? 0), 0);
  const buffBonus = Math.min(3, Math.max(-3, rawBuffBonus));
  const hasActiveHelper = choice.flavor === 'combo' && !!choice.helperCharacterName && party.some(c => c.name === choice.helperCharacterName && c.status === 'active' && c.id !== activeCharacter?.id);
  const helperBonus = hasActiveHelper ? COMBO_HELPER_BONUS : 0;
  const hasChoiceItem = choice.flavor === 'item' && !!activeCharacter && choice.itemOwnerName === activeCharacter.name && !!choice.itemName && activeCharacter.inventory.some(item => item.name === choice.itemName);
  const choiceItemBonus = hasChoiceItem ? CHOICE_ITEM_BONUS : 0;
  const characterBonus = choice.flavor === 'spotlight' || choice.flavor === 'social' ? CHARACTER_EDGE_BONUS : 0;
  const characterBonusLabel = choice.flavor === 'spotlight' ? 'spotlight' : choice.flavor === 'social' ? 'social' : '';
  const statTotal = statBase + statBonus + buffBonus + helperBonus + choiceItemBonus + characterBonus;
  const target = beatTarget(choice.difficultyValue, choice.difficulty);
  return {
    statBase,
    statBonus,
    buffBonus,
    helperBonus,
    choiceItemBonus,
    characterBonus,
    characterBonusLabel,
    statTotal,
    target,
    prob: calcSuccessProb(statTotal, target),
    riskLabel: RISK_LABELS[choice.difficulty] ?? RISK_LABELS.normal,
    isRiddleAnswer: !!choice.riddleAnswer,
  };
}
