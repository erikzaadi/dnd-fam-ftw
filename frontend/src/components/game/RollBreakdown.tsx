import { imgSrc } from '../../lib/api';
import { formatBuffBonusLabel, formatCharacterBonusLabel, formatChoiceItemBonusLabel, formatHelperBonusLabel } from './rollBonusLabels';

interface RollBreakdownProps {
  roll: number;
  statBonus?: number;
  itemBonus?: number;
  helperBonus?: number;
  helperCharacterName?: string;
  choiceItemBonus?: number;
  choiceItemName?: string;
  characterBonus?: number;
  characterBonusLabel?: string;
  buffBonus?: number;
  buffBonusLabel?: string;
  stat?: string;
  success: boolean;
  difficultyTarget?: number;
  /** Extra class applied to the outer wrapper, useful for font-size overrides */
  className?: string;
  /** Tailwind size for the dice icon, e.g. '6' or '10'. Defaults to '6'. */
  iconSize?: string;
}

const ICON_SIZE: Record<string, string> = {
  '4': 'w-4 h-4', '5': 'w-5 h-5', '6': 'w-6 h-6',
  '8': 'w-8 h-8', '10': 'w-10 h-10', '12': 'w-12 h-12',
};

export const RollBreakdown = ({
  roll,
  statBonus,
  itemBonus,
  helperBonus,
  helperCharacterName,
  choiceItemBonus,
  choiceItemName,
  characterBonus,
  characterBonusLabel,
  buffBonus,
  buffBonusLabel,
  stat,
  success,
  difficultyTarget,
  className = '',
  iconSize = '6',
}: RollBreakdownProps) => {
  const total = roll + (statBonus ?? 0) + (itemBonus ?? 0) + (helperBonus ?? 0) + (choiceItemBonus ?? 0) + (characterBonus ?? 0) + (buffBonus ?? 0);
  return (
    <div className={`flex flex-col items-center gap-0.5 ${className}`}>
      <div className="flex items-center gap-0.5 font-black flex-wrap justify-center">
        <img src={imgSrc('/images/icon_dice.png')} alt="d20" className={`${ICON_SIZE[iconSize] ?? 'w-6 h-6'} object-contain shrink-0 mix-blend-screen`} />
        <span className="text-slate-300">{roll}</span>
        {(statBonus ?? 0) > 0 && (
          <>
            <span className="text-slate-600">+</span>
            <span className="text-blue-400">{statBonus}{stat ? ` ${stat}` : ''}</span>
          </>
        )}
        {(itemBonus ?? 0) > 0 && (
          <>
            <span className="text-slate-600">+</span>
            <span className="text-amber-400">{itemBonus} items</span>
          </>
        )}
        {(helperBonus ?? 0) > 0 && (
	  <>
	    <span className="text-slate-600">+</span>
	    <span className="text-cyan-300">{formatHelperBonusLabel(helperBonus ?? 0, helperCharacterName)}</span>
	  </>
        )}
        {(choiceItemBonus ?? 0) > 0 && (
	  <>
	    <span className="text-slate-600">+</span>
	    <span className="text-amber-300">{formatChoiceItemBonusLabel(choiceItemBonus ?? 0, choiceItemName)}</span>
	  </>
        )}
        {(characterBonus ?? 0) > 0 && (
	  <>
	    <span className="text-slate-600">+</span>
	    <span className="text-fuchsia-300">{formatCharacterBonusLabel(characterBonus ?? 0, characterBonusLabel)}</span>
	  </>
        )}
        {(buffBonus ?? 0) !== 0 && (
	  <>
	    {(buffBonus ?? 0) > 0 && <span className="text-slate-600">+</span>}
	    <span className={(buffBonus ?? 0) > 0 ? 'text-emerald-300' : 'text-rose-300'}>{formatBuffBonusLabel(buffBonus ?? 0, buffBonusLabel)}</span>
	  </>
        )}
        <span className="text-slate-600">=</span>
        <span className={success ? 'text-emerald-400' : 'text-rose-400'}>{total}</span>
      </div>
      {difficultyTarget != null && (
        <span className="text-slate-400 text-sm uppercase tracking-widest font-black">Need ≥ {difficultyTarget}</span>
      )}
    </div>
  );
};
