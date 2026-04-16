import type { Choice, Character, ActionAttempt, TurnType } from '../../types';
import { imgSrc } from '../../lib/api';
import { beatTarget } from '../../lib/game';
import { D20 } from './D20';

interface TurnHistoryCardProps {
  choices: Choice[];
  takenAction: ActionAttempt | null;
  character: Character | null;
  turnType?: TurnType;
  narration?: string;
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

const SPECIAL_TURNS: Record<string, { img: string; label: string; borderClass: string; textClass: string }> = {
  intervention: {
    img: '/api/images/intervention_dragon.png',
    label: 'Miraculous Rescue',
    borderClass: 'border-amber-500/60',
    textClass: 'text-amber-400',
  },
  sanctuary: {
    img: '/api/images/sanctuary_light.png',
    label: 'Sanctuary',
    borderClass: 'border-blue-400/60',
    textClass: 'text-blue-300',
  },
};

export const TurnHistoryCard = ({ choices, takenAction, character, turnType, narration }: TurnHistoryCardProps) => {
  const special = turnType && turnType !== 'normal' ? SPECIAL_TURNS[turnType] : null;

  if (special) {
    return (
      <div className={`flex flex-col sm:flex-row gap-4 p-4 lg:p-6 bg-slate-900/50 rounded-[40px] border ${special.borderClass}`}>
        <div className="flex sm:flex-col items-center gap-3 sm:gap-2 sm:w-28 sm:shrink-0">
          <img
            src={imgSrc(special.img)}
            className="w-[72px] h-[72px] rounded-2xl object-cover border-2 border-slate-600"
          />
          <div className="sm:text-center">
            <div className={`font-black text-xs uppercase tracking-widest ${special.textClass}`}>{special.label}</div>
          </div>
        </div>
        <div className="flex-grow min-w-0 flex items-center">
          <p className="text-slate-400 text-sm leading-relaxed italic">{narration}</p>
        </div>
      </div>
    );
  }

  const takenLabel = takenAction?.actionAttempt ?? '';
  const { roll = 0, success = true, statUsed = 'none' } = takenAction?.actionResult ?? {};
  const isCustomAction = takenLabel && !choices.some(c => c.label === takenLabel);
  const hasRoll = statUsed !== 'none';

  return (
    <div className="flex flex-col lg:flex-row gap-4 p-4 lg:p-6 bg-slate-900/50 rounded-[40px] border border-slate-800">

      {/* Character column */}
      <div className="flex lg:flex-col items-center gap-3 lg:gap-2 lg:w-28 lg:shrink-0">
        <img
          src={imgSrc(character?.avatarUrl)}
          className="w-18 h-18 w-[72px] h-[72px] rounded-2xl object-cover border-2 border-slate-600"
        />
        <div className="lg:text-center">
          <div className="font-black text-xs uppercase tracking-widest text-slate-300">{character?.name ?? '-'}</div>
          {character && (
            <div className="text-[9px] text-slate-500 uppercase tracking-wide">{character.class} · {character.species}</div>
          )}
        </div>
      </div>

      {/* Choices column */}
      <div className="flex-grow min-w-0 space-y-3">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
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
                  {choice.stat} · beat {beatTarget(choice.difficultyValue, choice.difficulty)}
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
