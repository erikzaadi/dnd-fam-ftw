import type { Choice, Character, ActionAttempt } from '../../types';

interface TurnHistoryCardProps {
  choices: Choice[];
  takenAction: ActionAttempt | null;
  character: Character | null;
}

const STAT_COLORS: Record<string, string> = {
  might: 'border-rose-500/50 bg-rose-950/20 text-rose-300',
  magic: 'border-blue-500/50 bg-blue-950/20 text-blue-300',
  mischief: 'border-purple-500/50 bg-purple-950/20 text-purple-300',
  none: 'border-slate-600 bg-slate-900 text-slate-300'
};

const DIFF_COLORS: Record<string, string> = {
  easy: 'shadow-[inset_0_0_8px_rgba(34,197,94,0.2)]',
  normal: 'shadow-[inset_0_0_8px_rgba(245,158,11,0.2)]',
  hard: 'shadow-[inset_0_0_8px_rgba(239,68,68,0.2)]'
};

const D20 = ({ roll, success }: { roll: number; success: boolean }) => {
  const isNat20 = roll === 20;
  const isNat1 = roll === 1;
  const color = isNat20 ? '#22c55e' : isNat1 ? '#ef4444' : success ? '#f59e0b' : '#f87171';
  const fontSize = roll >= 10 ? 27 : 32;

  return (
    <svg viewBox="0 0 100 112" width="72" height="81" fill="none">
      {/* Outer hex shape */}
      <polygon
        points="50,4 95,30 95,82 50,108 5,82 5,30"
        stroke={color} strokeWidth="2.5" fill={`${color}18`}
      />
      {/* Top cap divider */}
      <line x1="5" y1="30" x2="95" y2="30" stroke={color} strokeWidth="1.5" opacity="0.35"/>
      {/* Bottom cap divider */}
      <line x1="5" y1="82" x2="95" y2="82" stroke={color} strokeWidth="1.5" opacity="0.35"/>
      {/* Top facet lines */}
      <line x1="50" y1="4" x2="5" y2="30" stroke={color} strokeWidth="1" opacity="0.2"/>
      <line x1="50" y1="4" x2="95" y2="30" stroke={color} strokeWidth="1" opacity="0.2"/>
      {/* Roll number */}
      <text
        x="50" y="68"
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="900"
        fill={color}
        fontFamily="sans-serif"
      >
        {roll}
      </text>
    </svg>
  );
};

export const TurnHistoryCard = ({ choices, takenAction, character }: TurnHistoryCardProps) => {
  const takenLabel = takenAction?.actionAttempt ?? '';
  const { roll = 0, success = true, statUsed = 'none' } = takenAction?.actionResult ?? {};
  const isCustomAction = takenLabel && !choices.some(c => c.label === takenLabel);
  const hasRoll = statUsed !== 'none';

  return (
    <div className="flex gap-5 p-6 bg-slate-900/50 rounded-[40px] border border-slate-800">

      {/* Character column */}
      <div className="flex flex-col items-center gap-2 w-28 shrink-0">
        <img
          src={character?.avatarUrl || '/api/images/default_scene.png'}
          className="w-18 h-18 w-[72px] h-[72px] rounded-2xl object-cover border-2 border-slate-600"
        />
        <span className="font-black text-xs uppercase tracking-widest text-center text-slate-300">{character?.name ?? '—'}</span>
        {character && (
          <div className="text-center space-y-0.5">
            <div className="text-[9px] text-slate-500 uppercase tracking-wide">{character.class} · {character.species}</div>
            <div className="text-[9px] text-slate-400 font-black">{character.hp}/{character.max_hp} HP</div>
          </div>
        )}
      </div>

      {/* Choices column */}
      <div className="flex-grow space-y-3 min-w-0">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {choices.map((choice, i) => {
            const isChosen = choice.label === takenLabel;
            return (
              <div
                key={i}
                className={`p-3 rounded-2xl border-2 text-sm font-black uppercase select-none flex flex-col items-center justify-between min-h-[72px]
                  ${isChosen ? 'border-amber-400 bg-amber-500/20 text-amber-200' : `${STAT_COLORS[choice.stat]} opacity-40`}
                  ${DIFF_COLORS[choice.difficulty]}`}
              >
                <span className="leading-tight text-center">{choice.label}</span>
                <span className={`text-[9px] font-black tracking-widest px-2 py-0.5 rounded-full opacity-80
                  ${isChosen ? 'bg-amber-900/60' : choice.stat === 'might' ? 'bg-rose-900/60' : choice.stat === 'magic' ? 'bg-blue-900/60' : 'bg-purple-900/60'}`}>
                  {choice.stat} · {choice.difficulty}
                </span>
              </div>
            );
          })}
        </div>

        {isCustomAction && (
          <div className="px-4 py-3 bg-slate-800 rounded-xl border border-amber-400/40 text-amber-200 text-sm font-semibold">
            "{takenLabel}"
          </div>
        )}
      </div>

      {/* D20 column */}
      {hasRoll ? (
        <div className="flex flex-col items-center gap-1 shrink-0 justify-center">
          <D20 roll={roll} success={success} />
          <span className={`text-[9px] font-black uppercase tracking-widest ${success ? 'text-amber-500' : 'text-rose-400'}`}>
            {success ? 'success' : 'fail'}
          </span>
          <span className="text-[8px] uppercase tracking-widest text-slate-500">{statUsed}</span>
          {(takenAction?.actionResult?.itemBonus ?? 0) > 0 && (
            <span className="text-[9px] font-black text-amber-400">+{takenAction!.actionResult.itemBonus} items</span>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center shrink-0 w-[72px]">
          <div className="w-12 h-12 rounded-full border-2 border-slate-700 flex items-center justify-center">
            <span className="text-slate-500 text-lg">✓</span>
          </div>
          <span className="text-[9px] uppercase tracking-widest text-slate-500 mt-1">no roll</span>
        </div>
      )}
    </div>
  );
};
