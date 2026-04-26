import { imgSrc } from '../../lib/api';

interface RollBreakdownProps {
  roll: number;
  statBonus?: number;
  itemBonus?: number;
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
  stat,
  success,
  difficultyTarget,
  className = '',
  iconSize = '6',
}: RollBreakdownProps) => {
  const total = roll + (statBonus ?? 0) + (itemBonus ?? 0);
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
        <span className="text-slate-600">=</span>
        <span className={success ? 'text-emerald-400' : 'text-rose-400'}>{total}</span>
      </div>
      {difficultyTarget != null && (
        <span className="text-slate-400 text-sm uppercase tracking-widest font-black">Need ≥ {difficultyTarget}</span>
      )}
    </div>
  );
};
