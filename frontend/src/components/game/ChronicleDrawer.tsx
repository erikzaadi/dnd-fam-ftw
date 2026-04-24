import { useState } from 'react';
import type { TurnResult, Character } from '../../types';
import { imgSrc } from '../../lib/api';
import { beatTarget } from '../../lib/game';
import { D20 } from './D20';
import { RollBreakdown } from './RollBreakdown';
import type { TtsSettings } from '../../tts/ttsTypes';

interface ChronicleDrawerProps {
  history: TurnResult[];
  party: Character[];
  onClose: () => void;
  onSelectTurn: (idx: number) => void;
  viewedTurnIdx: number;
  ttsSettings: TtsSettings;
}

const STAT_COLORS: Record<string, string> = {
  might: 'border-rose-500/50 bg-rose-950/20 text-rose-300',
  magic: 'border-blue-500/50 bg-blue-950/20 text-blue-300',
  mischief: 'border-purple-500/50 bg-purple-950/20 text-purple-300',
  none: 'border-slate-600 bg-slate-900 text-slate-300',
};

const SPECIAL_TURNS: Record<string, { img: string; label: string; borderClass: string; textClass: string }> = {
  intervention: {
    img: '/images/intervention_dragon.png',
    label: 'Miraculous Rescue',
    borderClass: 'border-amber-500/60',
    textClass: 'text-amber-400',
  },
  sanctuary: {
    img: '/images/sanctuary_light.png',
    label: 'Sanctuary',
    borderClass: 'border-blue-400/60',
    textClass: 'text-blue-300',
  },
};

// Narrow-column expanded turn view, designed for ~380-420px panels
const TurnDetail = ({
  turn,
  actor,
  takenAction,
  takenChar,
}: {
  turn: TurnResult;
  actor: Character | null;
  takenAction: ReturnType<typeof turn.lastAction extends infer T ? () => T : never> | null;
  takenChar: Character | null;
}) => {
  const special = turn.turnType && turn.turnType !== 'normal' ? SPECIAL_TURNS[turn.turnType] : null;
  const roll = takenAction?.actionResult;
  const hasRoll = roll && roll.statUsed !== 'none';
  const takenLabel = takenAction?.actionAttempt ?? '';
  const isCustom = takenLabel && !turn.choices.some(c => c.label === takenLabel);

  return (
    <div className={`flex flex-col gap-3 p-4 rounded-[24px] border bg-slate-900/50 ${special ? special.borderClass : 'border-slate-700/60'}`}>
      {/* Special turn header */}
      {special && (
        <div className="flex items-center gap-3">
          <img src={imgSrc(special.img)} className="w-10 h-10 rounded-xl object-cover border border-slate-600" alt="" />
          <span className={`text-xs font-black uppercase tracking-widest ${special.textClass}`}>{special.label}</span>
        </div>
      )}

      {/* Actor + roll - roll takes center stage when present */}
      {(takenChar || actor) && (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <img
              src={imgSrc((takenChar ?? actor)?.avatarUrl)}
              className="w-10 h-10 rounded-full object-cover border border-slate-600 shrink-0"
              alt={(takenChar ?? actor)?.name}
            />
            <div className="min-w-0">
              <div className="font-black text-sm uppercase tracking-wide text-slate-200 truncate">
                {(takenChar ?? actor)?.name}
              </div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide truncate">
                {(takenChar ?? actor)?.class}
              </div>
            </div>
          </div>
          {hasRoll && (
            <div className="flex flex-col items-center gap-1 shrink-0">
              <D20 roll={roll.roll} success={roll.success} size={64} />
              <span className={`text-[10px] font-black uppercase tracking-widest ${roll.success ? 'text-amber-500' : 'text-rose-400'}`}>
                {roll.success ? 'success' : 'fail'}
              </span>
              <RollBreakdown
                roll={roll.roll}
                statBonus={roll.statBonus}
                itemBonus={roll.itemBonus}
                success={roll.success}
                difficultyTarget={roll.difficultyTarget}
                className="text-xs"
              />
            </div>
          )}
          {!hasRoll && takenAction && (
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className="w-12 h-12 rounded-full border-2 border-slate-700 flex items-center justify-center">
                <span className="text-slate-400 text-lg">✓</span>
              </div>
              <span className="text-[9px] uppercase tracking-widest text-slate-600">no roll</span>
            </div>
          )}
        </div>
      )}

      {/* Custom action */}
      {isCustom && (
        <div className="px-3 py-2 bg-slate-800 rounded-xl border border-amber-400/40 text-amber-200 text-xs font-semibold italic">
          "{takenLabel}"
        </div>
      )}

      {/* Choices - vertical stack, chosen highlighted */}
      {turn.choices.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {turn.choices.map((choice, i) => {
            const isChosen = choice.label === takenLabel;
            return (
              <div
                key={i}
                className={`px-3 py-2.5 rounded-2xl border-2 flex items-center justify-between gap-2
                  ${isChosen ? 'border-amber-400 bg-amber-500/20 text-amber-200' : `${STAT_COLORS[choice.stat]} opacity-40`}`}
              >
                <span className="font-black text-xs uppercase leading-tight">{choice.label}</span>
                <span className={`text-[8px] font-black tracking-widest px-1.5 py-0.5 rounded-full shrink-0
                  ${isChosen ? 'bg-amber-900/60' : choice.stat === 'might' ? 'bg-rose-900/60' : choice.stat === 'magic' ? 'bg-blue-900/60' : 'bg-purple-900/60'}`}>
                  {choice.stat} · {beatTarget(choice.difficultyValue, choice.difficulty)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const ChronicleDrawer = ({
  history,
  party,
  onClose,
  onSelectTurn,
  viewedTurnIdx,
}: ChronicleDrawerProps) => {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const handleRowClick = (i: number) => {
    onSelectTurn(i);
    setExpandedIdx(prev => (prev === i ? null : i));
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-[32px] border border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
        <h2 className="font-display font-black uppercase tracking-widest text-amber-500 text-base">Chronicle</h2>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 font-black text-sm transition-all"
        >
          ✕
        </button>
      </div>

      {/* Turn list */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {history.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-600 text-xs font-black uppercase tracking-widest">
            No turns yet
          </div>
        ) : (
          [...history].reverse().map((turn, reversedI) => {
            const i = history.length - 1 - reversedI;
            const actor = turn.characterId ? party.find(c => c.id === turn.characterId) : null;
            const isSelected = viewedTurnIdx === i;
            const isExpanded = expandedIdx === i;
            const roll = turn.lastAction?.actionResult;
            const hasRoll = roll && roll.statUsed !== 'none';
            const nextTurn = history[i + 1] ?? null;
            const takenAction = nextTurn?.lastAction ?? null;
            const takenChar = nextTurn?.characterId ? party.find(c => c.id === nextTurn.characterId) ?? null : null;

            return (
              <div key={i} className={`border-b border-slate-800/60 last:border-0 ${isSelected ? 'bg-amber-500/5' : ''}`}>
                {/* Compact row */}
                <button
                  onClick={() => handleRowClick(i)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all hover:bg-slate-800/50 ${isSelected ? 'bg-amber-500/5' : ''}`}
                >
                  <span className={`text-[9px] font-black uppercase tracking-widest shrink-0 w-5 text-center ${isSelected ? 'text-amber-500' : 'text-slate-600'}`}>
                    {i + 1}
                  </span>
                  {actor ? (
                    <img src={imgSrc(actor.avatarUrl)} className="w-6 h-6 rounded-full object-cover border border-slate-700 shrink-0" alt={actor.name} />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 shrink-0" />
                  )}
                  <p className={`flex-1 min-w-0 text-[11px] italic leading-snug truncate ${isSelected ? 'text-slate-200' : 'text-slate-500'}`}>
                    {turn.narration}
                  </p>
                  {hasRoll && (
                    <span className={`shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-full ${roll.success ? 'bg-emerald-900/60 text-emerald-400' : 'bg-rose-900/60 text-rose-400'}`}>
                      {roll.roll}
                    </span>
                  )}
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-3 pb-3 animate-in fade-in duration-200">
                    <TurnDetail
                      turn={turn}
                      actor={actor ?? null}
                      takenAction={takenAction}
                      takenChar={takenChar}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
