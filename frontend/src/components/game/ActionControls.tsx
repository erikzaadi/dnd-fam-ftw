import { useState } from 'react';
import type { TurnResult, Choice, Character } from '../../types';
import { api, imgSrc, pulseSyncDelay } from '../../lib/api';
import { beatTarget } from '../../lib/game';

interface ActionControlsProps {
  turn: TurnResult | null;
  loading: boolean;
  onSubmit: (label: string, stat: string, diff: string, difficultyValue?: number) => void;
  customAction: string;
  setCustomAction: (action: string) => void;
  activeCharacter: Character | null;
  sessionId: string;
}

const STAT_COLORS: Record<string, string> = {
  might: 'border-rose-500 bg-rose-950/30 text-rose-200',
  magic: 'border-blue-500 bg-blue-950/30 text-blue-200',
  mischief: 'border-purple-500 bg-purple-950/30 text-purple-200',
  none: 'border-slate-500 bg-slate-900 text-slate-200'
};

const DIFF_COLORS: Record<string, string> = {
  easy: 'shadow-[inset_0_0_10px_rgba(34,197,94,0.3)]',
  normal: 'shadow-[inset_0_0_10px_rgba(245,158,11,0.3)]',
  hard: 'shadow-[inset_0_0_10px_rgba(239,68,68,0.3)]'
};


export const ActionControls = ({ turn, loading, onSubmit, customAction, setCustomAction, activeCharacter, sessionId }: ActionControlsProps) => {
  const [statThinking, setStatThinking] = useState(false);

  const submitCustom = async () => {
    if (!customAction.trim() || loading) return;
    setStatThinking(true);
    let stat = 'mischief';
    try {
      const res = await fetch(api(`/session/${sessionId}/suggest-stat`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: customAction, characterClass: activeCharacter?.class, characterQuirk: activeCharacter?.quirk }),
      });
      if (res.ok) ({ stat } = await res.json());
    } catch { /* fallback */ }
    setStatThinking(false);
    onSubmit(customAction, stat, 'normal');
  };

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 bg-slate-900/50 rounded-[40px] border border-slate-800">
      {/* Character row */}
      <div className="flex items-center gap-3">
        <img src={imgSrc(activeCharacter?.avatarUrl)} className="w-12 h-12 rounded-2xl object-cover border-2 border-amber-500 animate-border-pulse shrink-0" style={{ animationDelay: pulseSyncDelay() }} />
        {activeCharacter && (
          <div className="flex items-start gap-4">
            <div className="flex flex-col gap-0.5">
              <div className="font-black text-xs uppercase tracking-widest">{activeCharacter.name}</div>
              <div className="text-[9px] text-slate-400 uppercase tracking-wide">{activeCharacter.class} · {activeCharacter.species}</div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-xs text-amber-500 font-black">{activeCharacter.hp}/{activeCharacter.max_hp} HP</div>
              <div className="flex gap-2">
                {(['might', 'magic', 'mischief'] as const).map(stat => {
                  const base = activeCharacter.stats[stat];
                  const bonus = activeCharacter.inventory.reduce((s, item) => s + (item.statBonuses?.[stat] ?? 0), 0);
                  const ICONS = { might: '⚔️', magic: '✨', mischief: '🃏' };
                  const COLORS = { might: 'text-rose-400', magic: 'text-blue-400', mischief: 'text-purple-400' };
                  return (
                    <span key={stat} className={`text-xs font-black ${COLORS[stat]}`}>
                      {ICONS[stat]} {base}{bonus > 0 ? <span className="text-amber-400">+{bonus}</span> : null}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Choices */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 min-w-0">
        {turn?.choices.map((choice: Choice, i: number) => (
          <button
            key={i}
            onClick={() => onSubmit(choice.label, choice.stat, choice.difficulty, choice.difficultyValue)}
            disabled={loading}
            className={`relative z-0 hover:z-10 w-full min-w-0 overflow-hidden p-4 rounded-2xl border-2 text-base font-black uppercase transition-all flex flex-col items-center justify-between min-h-[80px]
                ${STAT_COLORS[choice.stat]} ${DIFF_COLORS[choice.difficulty]} hover:scale-105 disabled:opacity-50`}
          >
            <span className="leading-tight text-center break-words w-full">{choice.label}</span>
            <span className={`text-[9px] font-black tracking-widest px-2 py-0.5 rounded-full opacity-80 mt-1 shrink-0
                ${choice.stat === 'might' ? 'bg-rose-900/60' : choice.stat === 'magic' ? 'bg-blue-900/60' : 'bg-purple-900/60'}`}>
              {choice.stat} · {choice.difficulty} (&gt;{beatTarget(choice.difficultyValue, choice.difficulty)})
            </span>
          </button>
        ))}
      </div>

      {/* Custom action */}
      <div className="flex gap-3">
        <input
          value={customAction}
          onChange={(e) => setCustomAction(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitCustom(); }}
          className="flex-1 min-w-0 p-4 bg-slate-800 rounded-xl"
          placeholder="What do you do?"
          disabled={loading || statThinking}
        />
        <button
          onClick={submitCustom}
          disabled={loading || statThinking || !customAction.trim()}
          className="shrink-0 px-6 py-4 bg-amber-600 rounded-xl font-black uppercase disabled:opacity-50 min-w-[100px]"
        >
          {statThinking ? '...' : 'UNLEASH'}
        </button>
      </div>
    </div>
  );
};
