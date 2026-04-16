const STAT_ICONS: Record<string, string> = {
  might: '⚔️',
  magic: '✨',
  mischief: '🃏',
};

const STAT_COLORS: Record<string, string> = {
  might: 'text-rose-400',
  magic: 'text-blue-400',
  mischief: 'text-purple-400',
};

interface StatIconProps {
  stat: 'might' | 'magic' | 'mischief';
  base: number;
  bonus?: number;
  className?: string;
}

export const StatIcon = ({ stat, base, bonus = 0, className = '' }: StatIconProps) => (
  <span className={`relative group inline-flex items-center text-xs font-black ${STAT_COLORS[stat]} ${className}`}>
    {STAT_ICONS[stat]} {base}{bonus > 0 ? <span className="text-amber-400 ml-0.5">+{bonus}</span> : null}
    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-[10px] font-black uppercase tracking-widest text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
      {stat}
      <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-700" />
    </span>
  </span>
);
