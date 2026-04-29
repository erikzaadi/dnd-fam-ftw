interface ItemBonusBadgeProps {
  value: number;
  label: string;
  type: 'hp' | 'stat';
  /** Compact mode uses smaller responsive text/padding for inline use */
  compact?: boolean;
}

export const ItemBonusBadge = ({ value, label, type, compact }: ItemBonusBadgeProps) => {
  const colorClass = type === 'hp'
    ? 'bg-emerald-500/20 text-emerald-400'
    : 'bg-amber-500/20 text-amber-400';
  const sizeClass = compact
    ? 'text-[8px] xl:text-[10px] px-1 xl:px-1.5 py-0.5'
    : 'text-[9px] px-1.5 py-0.5';

  return (
    <span className={`font-black uppercase tracking-widest rounded-full ${colorClass} ${sizeClass}`}>
      +{value} {label}
    </span>
  );
};
