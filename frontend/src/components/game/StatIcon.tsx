import { imgSrc } from '../../lib/api';

const STAT_COLORS: Record<string, string> = {
  might: 'text-rose-400',
  magic: 'text-blue-400',
  mischief: 'text-purple-400',
};

// Explicit map so Tailwind can see the class names at build time (dynamic w-${n} gets purged).
const SIZE_CLASS: Record<string, string> = {
  '3': 'w-3 h-3',
  '4': 'w-4 h-4',
  '5': 'w-5 h-5',
  '6': 'w-6 h-6',
  '8': 'w-8 h-8',
  '10': 'w-10 h-10',
  '12': 'w-12 h-12',
  '16': 'w-16 h-16',
};

/** Inline stat image icon. mix-blend-screen strips the dark background so only the glow shows. */
export const StatImg = ({ stat, size = '4', className = '', tooltip, rounded = false }: { stat: string; size?: string; className?: string; tooltip?: boolean; rounded?: boolean }) => {
  const roundedClass = rounded ? 'rounded-lg' : '';
  if (tooltip) {
    return (
      <span className="relative group inline-flex">
        <img
          src={imgSrc(`/images/icon_${stat}.png`)}
          alt={stat}
          className={`${SIZE_CLASS[size] ?? 'w-4 h-4'} object-contain shrink-0 mix-blend-screen ${roundedClass} ${className}`}
        />
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-[10px] font-black uppercase tracking-widest text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
          {stat}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-700" />
        </span>
      </span>
    );
  }
  return (
    <img
      src={imgSrc(`/images/icon_${stat}.png`)}
      alt={stat}
      className={`${SIZE_CLASS[size] ?? 'w-4 h-4'} object-contain shrink-0 mix-blend-screen ${roundedClass} ${className}`}
    />
  );
};

interface StatIconProps {
  stat: 'might' | 'magic' | 'mischief';
  base: number;
  bonus?: number;
  className?: string;
  iconSize?: string;
}

export const StatIcon = ({ stat, base, bonus = 0, className = '', iconSize = '6' }: StatIconProps) => (
  <span className={`relative group inline-flex items-center gap-1 text-xs font-black ${STAT_COLORS[stat]} ${className}`}>
    <StatImg stat={stat} size={iconSize} />
    {base}{bonus > 0 ? <span className="text-amber-400 ml-0.5">+{bonus}</span> : null}
    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-[10px] font-black uppercase tracking-widest text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
      {stat}
      <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-700" />
    </span>
  </span>
);
