const VARIANTS = {
  use: {
    colors: 'bg-emerald-900/60 text-emerald-400 hover:bg-emerald-800/60 border border-emerald-700/40',
    label: 'Use',
  },
  give: {
    colors: 'bg-blue-900/60 text-blue-400 hover:bg-blue-800/60 border border-blue-700/40',
    label: 'Give',
  },
} as const;

interface ActionButtonProps {
  action: 'use' | 'give';
  onClick: () => void;
  /** Compact mode uses tighter padding and smaller responsive text */
  compact?: boolean;
}

export const ActionButton = ({ action, onClick, compact }: ActionButtonProps) => {
  const { colors, label } = VARIANTS[action];
  const sizeClass = compact
    ? 'px-1.5 py-0.5 rounded text-[8px] xl:text-[10px]'
    : 'px-2.5 py-1 rounded-lg text-xs';

  return (
    <button
      onClick={onClick}
      className={`${sizeClass} font-black uppercase tracking-widest ${colors} transition-all`}
    >
      {label}
    </button>
  );
};
