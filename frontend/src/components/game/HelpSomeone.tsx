import { useState } from 'react';
import type { Character } from '../../types';

// One place for support actions (bless, aid, rally), in plain words. Each choice opens
// the usual preview, so the action can still be read, edited, or cancelled.
export const HelpSomeone = ({
  party,
  activeCharacterId,
  disabled,
  onBless,
  onAid,
  onRally,
}: {
  party: Character[];
  activeCharacterId: string | undefined;
  disabled: boolean;
  onBless?: (targetCharacterId: string) => void;
  onAid?: (targetCharacterId: string) => void;
  onRally?: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const allies = party.filter(c => c.id !== activeCharacterId && c.status !== 'downed');
  const canHelpAlly = !!(onBless || onAid) && allies.length > 0;
  if (!onRally && !canHelpAlly) {
    return null;
  }

  const choose = (act: () => void) => {
    setOpen(false);
    act();
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
        disabled={disabled}
        className="w-full py-2.5 rounded-2xl border border-emerald-700/50 bg-emerald-950/40 text-emerald-200 text-sm font-black uppercase tracking-wide hover:bg-emerald-900/50 disabled:opacity-50 transition-colors"
      >
        Help someone
      </button>
      {open && (
        <div role="group" aria-label="Help someone" className="flex flex-col gap-2 rounded-2xl border border-emerald-800/50 bg-slate-900/80 p-3">
          {onRally && (
            <button
              type="button"
              onClick={() => choose(onRally)}
              disabled={disabled}
              className="flex flex-col items-start rounded-xl border border-emerald-700/50 px-3 py-2 text-left hover:bg-emerald-900/40 disabled:opacity-50"
            >
              <span className="text-sm font-black text-emerald-200">✦ Rally everyone</span>
              <span className="text-xs text-slate-400">The whole party gets a short boost.</span>
            </button>
          )}
          {canHelpAlly && allies.map(ally => (
            <div key={ally.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-700/60 px-3 py-2">
              <span className="min-w-0 truncate text-sm font-bold text-slate-200">{ally.name}</span>
              <div className="flex shrink-0 gap-1.5">
                {onBless && (
                  <button
                    type="button"
                    onClick={() => choose(() => onBless(ally.id))}
                    disabled={disabled}
                    aria-label={`Bless ${ally.name}`}
                    className="rounded-full border border-blue-700/60 px-3 py-1 text-xs font-black uppercase tracking-wide text-blue-200 hover:bg-blue-900/40 disabled:opacity-50"
                  >
                    Bless
                  </button>
                )}
                {onAid && (
                  <button
                    type="button"
                    onClick={() => choose(() => onAid(ally.id))}
                    disabled={disabled}
                    aria-label={`Aid ${ally.name}`}
                    className="rounded-full border border-emerald-700/60 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-200 hover:bg-emerald-900/40 disabled:opacity-50"
                  >
                    Aid
                  </button>
                )}
              </div>
            </div>
          ))}
          {canHelpAlly && (
            <p className="text-xs text-slate-500">
              Bless: a little protective magic for a few turns. Aid: set them up for their next move.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
