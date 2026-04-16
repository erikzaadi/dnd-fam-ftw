interface RollBreakdownProps {
  roll: number;
  statBonus?: number;
  itemBonus?: number;
  stat?: string;
  success: boolean;
  difficultyTarget?: number;
  /** Extra class applied to the outer wrapper, useful for font-size overrides */
  className?: string;
}

export const RollBreakdown = ({
  roll,
  statBonus,
  itemBonus,
  stat,
  success,
  difficultyTarget,
  className = '',
}: RollBreakdownProps) => {
  const total = roll + (statBonus ?? 0) + (itemBonus ?? 0);
  return (
    <div className={`flex flex-col items-center gap-0.5 ${className}`}>
      <div className="flex items-baseline gap-0.5 font-black flex-wrap justify-center">
        <span className="text-slate-500 font-normal">d20·</span>
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
        <span className="text-slate-500 uppercase tracking-widest">≥ {difficultyTarget}</span>
      )}
    </div>
  );
};
