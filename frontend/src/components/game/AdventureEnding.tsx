import { useState } from 'react';
import type { AdventureFormat, Session, TurnResult } from '../../types';
import { imgSrc } from '../../lib/api';

interface AdventureEndingProps {
  session: Session;
  conclusion: TurnResult | null;
  continuing: boolean;
  error: string | null;
  onContinue: (format: AdventureFormat) => void;
  onViewChronicle: () => void;
  onHome: () => void;
}

const RESOLUTION_TITLES = {
  success: 'Victory!',
  setback: 'A Hard-Won Lesson',
  ended_early: 'To Be Continued...',
} as const;

// Readable completed session: the ending, the heroes, and an explicit way to continue
// the world. Continuing never erases the ending or re-runs the last turn.
export const AdventureEnding = ({ session, conclusion, continuing, error, onContinue, onViewChronicle, onHome }: AdventureEndingProps) => {
  const [longLived, setLongLived] = useState(false);
  const resolution = session.adventure?.resolution ?? 'success';

  return (
    <div className="min-h-dvh bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-slate-100 flex flex-col items-center justify-center gap-8 p-6 sm:p-8" data-testid="adventure-ending">
      <div className="flex max-w-2xl flex-col items-center gap-4 text-center">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-slate-500">
          {session.displayName}{session.adventure && session.adventure.chapter > 1 ? ` · Chapter ${session.adventure.chapter}` : ''}
        </p>
        <h1 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter text-amber-400 italic">{RESOLUTION_TITLES[resolution]}</h1>
        {session.adventure?.objective && (
          <p className="text-sm text-slate-500 italic">{session.adventure.objective}</p>
        )}
        <p className="text-lg sm:text-xl font-serif leading-relaxed text-slate-200">
          {conclusion?.narration ?? 'The story has reached its end.'}
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          {session.party.map(hero => (
            <span key={hero.id} className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 py-1 pl-1 pr-3 text-xs font-black text-slate-300">
              {hero.avatarUrl && (
                <img
                  src={imgSrc(hero.avatarUrl)}
                  alt=""
                  className="h-7 w-7 rounded-full object-cover border border-amber-600/40"
                />
              )}
              {hero.name}
            </span>
          ))}
        </div>
      </div>

      <div className="flex w-full max-w-md flex-col gap-3">
        <button
          type="button"
          disabled={continuing}
          onClick={() => onContinue(longLived ? 'long_lived' : 'one_evening')}
          className="w-full rounded-2xl bg-amber-600 py-4 font-black uppercase tracking-widest text-slate-950 hover:bg-amber-500 disabled:opacity-50"
        >
          {continuing ? 'Turning the page...' : 'Continue this world'}
        </button>
        <label className="flex items-start gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={longLived} disabled={continuing} onChange={e => setLongLived(e.target.checked)} className="mt-0.5" />
          <span>
            <span className="font-black text-slate-300">Long-lived session</span>
            <span className="block">Keep this world going across game nights. You can still wrap up a chapter whenever you like.</span>
          </span>
        </label>
        {error && <p className="text-sm text-rose-400" role="alert">{error}</p>}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onViewChronicle}
            className="flex-1 rounded-2xl border border-amber-600/40 bg-amber-600/10 py-3 text-sm font-black uppercase tracking-widest text-amber-400 hover:bg-amber-600/20"
          >
            View Chronicle
          </button>
          <button
            type="button"
            onClick={onHome}
            className="flex-1 rounded-2xl border border-slate-700 bg-slate-800 py-3 text-sm font-black uppercase tracking-widest text-slate-400 hover:bg-slate-700"
          >
            Return Home
          </button>
        </div>
      </div>
    </div>
  );
};
