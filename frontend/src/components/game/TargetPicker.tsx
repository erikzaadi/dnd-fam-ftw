import type { Character } from '../../types';
import { imgSrc } from '../../lib/api';

interface TargetPickerProps {
  party: Character[];
  action: 'use' | 'give';
  /** The character who owns the item - excluded from targets when action is 'give'. */
  ownerCharId: string;
  /** Compact inline row layout (no names). Default: full column layout with names. */
  compact?: boolean;
  onConfirm: (targetCharId: string) => void;
  onCancel: () => void;
}

/** Avatar button shared by both compact and full layouts. */
const TargetAvatar = ({
  target,
  size,
  onConfirm,
  showName,
}: {
  target: Character;
  size: 'sm' | 'md';
  onConfirm: (id: string) => void;
  showName: boolean;
}) => {
  const sizeClass = size === 'sm' ? 'w-7 h-7' : 'w-9 h-9';
  const groupClass = showName ? 'group/target flex flex-col items-center gap-1' : '';
  const imgClass = [
    sizeClass,
    'rounded-full object-cover border-2 transition-all',
    showName ? 'group-hover/target:scale-110' : 'hover:scale-110',
    target.status === 'downed'
      ? 'grayscale opacity-50 border-slate-600'
      : showName
        ? 'border-slate-600 group-hover/target:border-amber-500'
        : 'border-slate-600 hover:border-amber-500',
  ].join(' ');

  return (
    <button
      onClick={() => onConfirm(target.id)}
      title={target.name}
      className={groupClass}
    >
      <img src={imgSrc(target.avatarUrl)} className={imgClass} alt={target.name} />
      {showName && (
        <span className="text-[8px] font-black uppercase tracking-widest text-slate-500 group-hover/target:text-amber-400">
          {target.name.split(' ')[0]}
        </span>
      )}
    </button>
  );
};

export const TargetPicker = ({ party, action, ownerCharId, compact, onConfirm, onCancel }: TargetPickerProps) => {
  const targets = action === 'give' ? party.filter(t => t.id !== ownerCharId) : party;
  const label = action === 'use' ? 'Use on:' : 'Give to:';

  if (compact) {
    return (
      <div className="flex gap-1 flex-wrap justify-end items-center mt-0.5">
        <span className="text-[8px] text-slate-500 uppercase tracking-widest font-black">{label}</span>
        {targets.map(target => (
          <TargetAvatar key={target.id} target={target} size="sm" onConfirm={onConfirm} showName={false} />
        ))}
        <button onClick={onCancel} className="text-[8px] text-slate-600 hover:text-slate-400 font-black px-1">✕</button>
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-slate-700">
      <p className="text-[9px] uppercase tracking-widest text-slate-500 mb-2">{label}</p>
      <div className="flex gap-2 flex-wrap">
        {targets.map(target => (
          <TargetAvatar key={target.id} target={target} size="md" onConfirm={onConfirm} showName={true} />
        ))}
        <button onClick={onCancel} className="self-start px-2 py-1 text-[9px] text-slate-600 hover:text-slate-400 font-black uppercase">✕</button>
      </div>
    </div>
  );
};
