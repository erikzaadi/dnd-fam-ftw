import { useState, useEffect } from 'react';
import type { TurnResult, Character, HpChange, InventoryChange, BuffChange, EncounterState } from '../../types';
import { imgSrc } from '../../lib/api';
import { StatImg } from './StatIcon';
import { beatTarget } from '../../lib/game';
import { D20 } from './D20';
import { RollBreakdown } from './RollBreakdown';
import type { TtsSettings } from '../../tts/ttsTypes';
import { NarrationTtsButton } from '../NarrationTtsButton';
import { STAT_COLORS } from '../../lib/statColors';
import { SPECIAL_TURNS } from '../../lib/specialTurns';
import { getRollImpactOutcome } from '../../lib/rollOutcome';

interface ChronicleDrawerProps {
  history: TurnResult[];
  party: Character[];
  pastEncounters?: EncounterState[];
  onClose: () => void;
  onSelectTurn: (idx: number) => void;
  viewedTurnIdx: number;
  ttsSettings: TtsSettings;
  hasTts: boolean;
}

const OUTCOME_STYLES: Record<string, { label: string; badge: string }> = {
  defeated: { label: 'Defeated', badge: 'border-emerald-700/60 bg-emerald-900/40 text-emerald-400' },
  fled:     { label: 'Fled',     badge: 'border-amber-700/60 bg-amber-900/40 text-amber-400' },
  surrendered: { label: 'Surrendered', badge: 'border-sky-700/60 bg-sky-900/40 text-sky-400' },
};

const CombatLog = ({ encounters }: { encounters: EncounterState[] }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-slate-800">
      <button
        onClick={() => setOpen(p => !p)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-800/40 transition-colors"
      >
        <span className="text-xs font-black uppercase tracking-widest text-slate-400">Combat Log</span>
        <span className="text-slate-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-4 pb-3">
          {encounters.map((enc, i) => {
            const outcome = OUTCOME_STYLES[enc.status] ?? OUTCOME_STYLES.defeated;
            return (
              <div key={i} className="flex flex-col gap-1.5 rounded-2xl border border-slate-700/50 bg-slate-800/30 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-200 truncate">{enc.name}</span>
                  <span className={`shrink-0 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${outcome.badge}`}>
                    {outcome.label}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {enc.enemies.map(enemy => (
                    <span
                      key={enemy.id}
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                        enemy.status === 'defeated'
                          ? 'border-rose-900/50 bg-rose-950/30 text-rose-500 line-through opacity-60'
                          : enemy.status === 'fled'
                            ? 'border-amber-900/50 bg-amber-950/30 text-amber-500'
                            : 'border-slate-700/50 bg-slate-800/50 text-slate-400'
                      }`}
                    >
                      {enemy.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const HpChangeBadges = ({ hpChanges }: { hpChanges: HpChange[] }) => (
  <div className="flex flex-wrap gap-1.5">
    {hpChanges.map(hc => (
      <div
        key={hc.characterId}
        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-black uppercase tracking-widest border ${hc.change < 0 ? 'bg-rose-900/40 border-rose-700/50 text-rose-400' : 'bg-emerald-900/40 border-emerald-700/50 text-emerald-400'}`}
      >
        <span>{hc.change < 0 ? '-' : '+'}{Math.abs(hc.change)}</span>
        <span className="text-xs opacity-70 normal-case tracking-normal font-semibold">{hc.characterName.split(' ')[0]}</span>
        <span className="opacity-50">{hc.newHp}/{hc.maxHp}</span>
      </div>
    ))}
  </div>
);

const InventoryChangeBadges = ({ inventoryChanges }: { inventoryChanges: InventoryChange[] }) => (
  <div className="flex flex-wrap gap-1.5">
    {inventoryChanges.map((ic, i) => (
      <div
        key={i}
        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-black border ${ic.type === 'added' ? 'bg-amber-900/40 border-amber-700/50 text-amber-400' : ic.type === 'updated' ? 'bg-indigo-900/40 border-indigo-700/50 text-indigo-300' : 'bg-slate-800/60 border-slate-700/50 text-slate-400'}`}
      >
        <span>{ic.type === 'added' ? '＋' : ic.type === 'updated' ? '✦' : '－'}</span>
        <span className="normal-case tracking-normal font-semibold truncate max-w-[120px]">{ic.itemName}</span>
        <span className="opacity-60 shrink-0">→ {ic.characterName.split(' ')[0]}</span>
      </div>
    ))}
  </div>
);

const BuffChangeBadges = ({ buffChanges }: { buffChanges: BuffChange[] }) => (
  <div className="flex flex-wrap gap-1.5">
    {buffChanges.map((bc, i) => {
      const isCurse = bc.kind === 'curse';
      const isAdded = bc.type === 'added';
      return (
        <div
          key={i}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-black border ${
            isCurse
              ? 'bg-rose-900/40 border-rose-700/50 text-rose-300'
              : 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300'
          }`}
        >
          <span>{isAdded ? (isCurse ? '⚑' : '✦') : '✕'}</span>
          <span className="normal-case tracking-normal font-semibold truncate max-w-[120px]">{bc.buffName}</span>
          <span className="opacity-60 shrink-0">→ {bc.characterName.split(' ')[0]}</span>
        </div>
      );
    })}
  </div>
);

// Narrow-column expanded turn view, designed for ~380-420px panels
const TurnDetail = ({
  turn,
  actor,
  takenAction,
  takenChar,
  nextTurnHpChanges,
  nextTurnInventoryChanges,
  nextTurnBuffChanges,
  ttsSettings,
  hasTts,
}: {
  turn: TurnResult;
  actor: Character | null;
  takenAction: ReturnType<typeof turn.lastAction extends infer T ? () => T : never> | null;
  takenChar: Character | null;
  nextTurnHpChanges?: HpChange[];
  nextTurnInventoryChanges?: InventoryChange[];
  nextTurnBuffChanges?: BuffChange[];
  ttsSettings: TtsSettings;
  hasTts: boolean;
}) => {
  const special = turn.turnType && turn.turnType !== 'normal' ? SPECIAL_TURNS[turn.turnType] : null;
  const roll = takenAction?.actionResult;
  const hasRoll = roll && roll.statUsed !== 'none';
  const rollOutcome = getRollImpactOutcome(roll?.roll, roll?.success, roll?.impact);
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
              <div className="text-xs text-slate-500 uppercase tracking-wide truncate">
                {(takenChar ?? actor)?.class}
              </div>
            </div>
          </div>
          {hasRoll && (
            <div className="flex flex-col items-center gap-1 shrink-0">
              <D20 roll={roll.roll} success={roll.success} size={64} />
              <span className={`text-xs font-black uppercase tracking-widest ${rollOutcome?.textClass ?? (roll.success ? 'text-amber-500' : 'text-rose-400')}`}>
                {rollOutcome?.label ?? (roll.success ? 'success' : 'fail')}
              </span>
              {rollOutcome && (
                <span className={`px-2 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-widest ${rollOutcome.badgeClass}`}>
                  {rollOutcome.detail}
                </span>
              )}
              <RollBreakdown
                roll={roll.roll}
                statBonus={roll.statBonus}
                itemBonus={roll.itemBonus}
                helperBonus={roll.helperBonus}
                helperCharacterName={roll.helperCharacterName}
                choiceItemBonus={roll.choiceItemBonus}
                choiceItemName={roll.choiceItemName}
                characterBonus={roll.characterBonus}
                characterBonusLabel={roll.characterBonusLabel}
                buffBonus={roll.buffBonus}
                buffBonusLabel={roll.buffBonusLabel}
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
              <span className="text-xs uppercase tracking-widest text-slate-600">no roll</span>
            </div>
          )}
        </div>
      )}

      {/* HP changes from the action taken */}
      {nextTurnHpChanges && nextTurnHpChanges.length > 0 && (
        <HpChangeBadges hpChanges={nextTurnHpChanges} />
      )}
      {nextTurnInventoryChanges && nextTurnInventoryChanges.length > 0 && (
        <InventoryChangeBadges inventoryChanges={nextTurnInventoryChanges} />
      )}
      {nextTurnBuffChanges && nextTurnBuffChanges.length > 0 && (
        <BuffChangeBadges buffChanges={nextTurnBuffChanges} />
      )}

      {/* Custom action */}
      {isCustom && (
        <div className="px-3 py-2 bg-slate-800 rounded-xl border border-amber-400/40 text-amber-200 text-xs font-semibold italic">
          "{takenLabel}"
        </div>
      )}

      <p className="font-narrative text-base sm:text-lg md:text-xl lg:text-2xl xl:text-3xl 2xl:text-4xl leading-relaxed text-slate-100 italic">
        {turn.narration}
      </p>

      <NarrationTtsButton
        text={turn.narration}
        ttsSettings={ttsSettings}
        hasTts={hasTts}
        turnId={turn.id}
      />

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
                <span className={`inline-flex items-center gap-1 text-xs font-black tracking-widest px-1.5 py-0.5 rounded-full shrink-0
                  ${isChosen ? 'bg-amber-900/60' : choice.stat === 'might' ? 'bg-rose-900/60' : choice.stat === 'magic' ? 'bg-blue-900/60' : 'bg-purple-900/60'}`}>
                  {choice.riddleAnswer ? (
                    'answer'
                  ) : (
                    <>
                      <StatImg stat={choice.stat} size="5" />
                      {choice.stat} · {beatTarget(choice.difficultyValue, choice.difficulty)}
                    </>
                  )}
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
  pastEncounters,
  onClose,
  onSelectTurn,
  viewedTurnIdx,
  ttsSettings,
  hasTts,
}: ChronicleDrawerProps) => {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'h' || e.key === 'j') {
        e.preventDefault();
        onSelectTurn(Math.max(0, viewedTurnIdx - 1));
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'l' || e.key === 'k') {
        e.preventDefault();
        onSelectTurn(Math.min(history.length - 1, viewedTurnIdx + 1));
      } else if (e.key === 'Enter') {
        setExpandedIdx(prev => (prev === viewedTurnIdx ? null : viewedTurnIdx));
        onSelectTurn(viewedTurnIdx);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, onSelectTurn, viewedTurnIdx, history.length]);

  const handleRowClick = (i: number) => {
    onSelectTurn(i);
    setExpandedIdx(prev => (prev === i ? null : i));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-900 rounded-[28px] sm:rounded-[32px] border border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 font-black text-lg transition-all"
            aria-label="Close chronicle"
          >
            ‹
          </button>
          <img src={imgSrc('/images/icon_scroll.png')} alt="" className="w-8 h-8 object-contain mix-blend-screen" />
          <h2 className="font-display font-black uppercase tracking-widest text-amber-500 text-base">Chronicle</h2>
        </div>
      </div>

      {/* Combat log */}
      {pastEncounters && pastEncounters.length > 0 && (
        <CombatLog encounters={pastEncounters} />
      )}

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
            const nextTurn = history[i + 1] ?? null;
            const takenAction = nextTurn?.lastAction ?? null;
            const takenChar = nextTurn?.characterId ? party.find(c => c.id === nextTurn.characterId) ?? null : null;
            const roll = takenAction?.actionResult;
            const hasRoll = roll && roll.statUsed !== 'none';
            const rollOutcome = getRollImpactOutcome(roll?.roll, roll?.success, roll?.impact);

            return (
              <div key={i} className={`border-b border-slate-800/60 last:border-0 ${isSelected ? 'bg-amber-500/5' : ''}`}>
                {/* Compact row */}
                <button
                  onClick={() => handleRowClick(i)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all hover:bg-slate-800/50 ${isSelected ? 'bg-amber-500/5' : ''}`}
                >
                  <span className={`text-xs font-black uppercase tracking-widest shrink-0 w-5 text-center ${isSelected ? 'text-amber-500' : 'text-slate-600'}`}>
                    {i + 1}
                  </span>
                  {actor ? (
                    <img src={imgSrc(actor.avatarUrl)} className="w-6 h-6 rounded-full object-cover border border-slate-700 shrink-0" alt={actor.name} />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 shrink-0" />
                  )}
                  <p className={`flex-1 min-w-0 text-xs italic leading-snug truncate ${isSelected ? 'text-slate-200' : 'text-slate-500'}`}>
                    {turn.narration}
                  </p>
                  {hasRoll && (
                    <span
                      className={`shrink-0 text-xs font-black px-1.5 py-0.5 rounded-full border ${
                        rollOutcome
                          ? rollOutcome.badgeClass
                          : roll.success
                            ? 'border-emerald-800/60 bg-emerald-900/60 text-emerald-400'
                            : 'border-rose-800/60 bg-rose-900/60 text-rose-400'
                      }`}
                      aria-label={rollOutcome ? `${rollOutcome.label}, ${rollOutcome.detail}` : undefined}
                    >
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
                      nextTurnHpChanges={nextTurn?.hpChanges}
                      nextTurnInventoryChanges={nextTurn?.inventoryChanges}
                      nextTurnBuffChanges={nextTurn?.buffChanges}
                      ttsSettings={ttsSettings}
                      hasTts={hasTts}
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
