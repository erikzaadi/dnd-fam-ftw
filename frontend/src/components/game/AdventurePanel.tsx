import { useState } from 'react';
import type { AdventureProgress } from '../../types';
import { ADVENTURE_PHASE_LABELS } from '../../session/adventureActions';
import { Tooltip } from '../Tooltip';

interface AdventurePanelProps {
  adventure: AdventureProgress;
  disabled: boolean;
  onWrapUp: () => void;
  onEndHere: () => void;
  onToggleLongLived: (longLived: boolean) => void;
}

// Session-management controls for the adventure lifecycle. These are not suggested
// adventure actions, so they stay available in every interaction mode.
export const AdventurePanel = ({ adventure, disabled, onWrapUp, onEndHere, onToggleLongLived }: AdventurePanelProps) => {
  const [expanded, setExpanded] = useState(false);
  const isEvening = adventure.format === 'one_evening';
  const inFinale = adventure.phase === 'finale';

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm" data-testid="adventure-panel">
      <div className="flex items-center gap-2">
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${inFinale ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>
          {adventure.chapter > 1 ? `Chapter ${adventure.chapter} · ` : ''}{ADVENTURE_PHASE_LABELS[adventure.phase]}
        </span>
        <p className="min-w-0 flex-1 truncate text-slate-300">
          {adventure.objective ?? (isEvening ? 'Tonight\'s quest is taking shape...' : 'An ongoing saga')}
        </p>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-200"
          aria-expanded={expanded}
          aria-label="Adventure options"
        >
          {expanded ? 'Close' : 'Story'}
        </button>
      </div>

      {adventure.continueOffered && (
        <div className="mt-2 rounded-xl border border-amber-700/40 bg-amber-950/30 p-2 text-amber-200" role="status">
          <p className="text-xs">The finale is running long. Keep playing, or end tonight with an epilogue?</p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={disabled} onClick={() => onToggleLongLived(true)} className="flex-1 rounded-lg bg-slate-800 px-2 py-1.5 text-xs font-black uppercase tracking-widest text-slate-200 disabled:opacity-40">
              Keep playing
            </button>
            <button type="button" disabled={disabled} onClick={onEndHere} className="flex-1 rounded-lg bg-amber-600/30 px-2 py-1.5 text-xs font-black uppercase tracking-widest text-amber-200 disabled:opacity-40">
              End with an epilogue
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="mt-2 flex flex-col gap-2 border-t border-slate-800 pt-2">
          <div className="flex flex-wrap gap-2">
            <Tooltip content="Ask the DM to steer toward a finale soon. Nothing is decided yet." position="top" portal>
              <button
                type="button"
                disabled={disabled || adventure.wrapUpRequested}
                onClick={onWrapUp}
                className="rounded-lg border border-amber-700/50 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-amber-300 hover:bg-amber-900/20 disabled:opacity-40"
              >
                {adventure.wrapUpRequested ? 'Finale requested' : 'Wrap up our adventure'}
              </button>
            </Tooltip>
            <Tooltip content="Stop now: the DM tells how things stand, without a new roll." position="top" portal>
              <button
                type="button"
                disabled={disabled}
                onClick={onEndHere}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                End here with an epilogue
              </button>
            </Tooltip>
          </div>
          <label className="flex items-start gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={!isEvening}
              disabled={disabled}
              onChange={e => onToggleLongLived(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-black text-slate-300">Long-lived session</span>
              <span className="block">Keep this world going across game nights. You can still wrap up a chapter whenever you like.</span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
};
