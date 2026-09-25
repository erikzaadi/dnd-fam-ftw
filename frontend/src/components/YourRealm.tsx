import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { LimitRequestErrorResponse, NamespaceUsageResponse } from '../types';

const formatReset = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const Meter = ({ label, used, limit, hint }: { label: string; used: number; limit: number; hint: string }) => {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 1;
  const spent = used >= limit;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-black uppercase tracking-tighter text-white text-sm">{label}</span>
        <span className={`text-sm font-mono ${spent ? 'text-rose-300' : 'text-slate-300'}`}>{Math.min(used, limit)} / {limit}</span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)}>
        <div className={`h-full rounded-full ${spent ? 'bg-rose-500' : 'bg-amber-500'}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
  );
};

// "Support the realm" (donation link) and "Ask for more" (a note to the owner, who can
// raise the group's tier). Donations never unlock anything automatically.
const MoreAdventures = ({ usage, onRequested }: { usage: NamespaceUsageResponse; onRequested: () => void }) => {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch('/namespace/limit-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      if (res.ok) {
        setAsking(false);
        onRequested();
        return;
      }
      const body = await res.json().catch(() => null) as LimitRequestErrorResponse | null;
      if (body?.error === 'already_requested') {
        setAsking(false);
        onRequested();
        return;
      }
      setError(body?.message ?? 'Could not send your request. Try again later.');
    } catch {
      setError("Couldn't reach the realm. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3 pt-2 border-t border-slate-800">
      <p className="text-sm text-slate-400">
        This realm is run by one family for fun. If you'd like more adventures, you can ask for more, and if you want to, help cover the hosting.
      </p>
      {usage.limitRequest ? (
        <p role="status" className="text-sm text-emerald-300">Your request is with the realm keeper. You'll get more once it's approved.</p>
      ) : asking ? (
        <div className="space-y-2">
          <label htmlFor="limit-request-note" className="text-slate-400 text-xs uppercase tracking-wider">Anything the realm keeper should know? (optional)</label>
          <textarea
            id="limit-request-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="We're a family of five and play most evenings..."
            className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm resize-none focus:outline-none focus:border-amber-700"
          />
          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={send}
              disabled={sending}
              className="flex-1 py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-60 rounded-[16px] font-black uppercase italic tracking-tighter text-sm text-white cursor-pointer"
            >
              {sending ? 'Sending...' : 'Send request'}
            </button>
            <button
              onClick={() => setAsking(false)}
              className="px-4 py-3 bg-slate-800 hover:bg-slate-700 rounded-[16px] font-black uppercase italic tracking-tighter text-sm text-slate-300 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col sm:flex-row gap-2">
        {usage.supportUrl && (
          <a
            href={usage.supportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-3 text-center bg-rose-900/60 hover:bg-rose-800/60 border border-rose-800 rounded-[16px] font-black uppercase italic tracking-tighter text-sm text-rose-100"
          >
            Support the realm
          </a>
        )}
        {!usage.limitRequest && !asking && (
          <button
            onClick={() => setAsking(true)}
            className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-[16px] font-black uppercase italic tracking-tighter text-sm text-slate-200 cursor-pointer"
          >
            Ask for more
          </button>
        )}
      </div>
    </div>
  );
};

// Tier, today's usage, and limits for the signed-in group. Shown in Settings.
export const YourRealm = () => {
  const [usage, setUsage] = useState<NamespaceUsageResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    apiFetch('/namespace/usage')
      .then(async res => {
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        setUsage(await res.json() as NamespaceUsageResponse);
      })
      .catch(() => setFailed(true));
  }, [reloadKey]);

  if (failed) {
    return null;
  }
  if (!usage) {
    return <p className="text-slate-500 text-sm">Checking your realm...</p>;
  }

  const unlimited = usage.tier === 'unlimited';
  const { limits, today } = usage;

  return (
    <section className="space-y-4 p-5 bg-amber-950/20 rounded-[20px] border-2 border-slate-800" aria-labelledby="your-realm-heading">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 id="your-realm-heading" className="text-lg font-black uppercase tracking-tighter text-amber-500">Your Realm</h2>
        <span className="px-3 py-1 rounded-full bg-amber-600/20 border border-amber-700/60 text-amber-300 text-xs font-black uppercase tracking-wider">
          {usage.tierLabel}
        </span>
      </div>

      {unlimited ? (
        <p className="text-sm text-slate-400">Your realm has no daily limits. Adventure as much as you like.</p>
      ) : (
        <>
          {limits.textCreditsPerDay !== null && (
            <Meter
              label="Adventure energy"
              used={today.textCredits}
              limit={limits.textCreditsPerDay}
              hint="Each turn, idea, question, and narration uses a little energy."
            />
          )}
          {limits.picturesPerDay !== null && (
            <Meter
              label="Pictures"
              used={today.pictures}
              limit={limits.picturesPerDay}
              hint="When the pictures run out, the story keeps going without them."
            />
          )}
          {usage.picturesPaused && (limits.picturesPerDay === null || today.pictures < limits.picturesPerDay) && (
            <p className="text-sm text-slate-400">The realm's painters are resting for today.</p>
          )}
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-slate-400">Adventures</span>
            <span className="font-mono text-slate-300">{usage.sessionCount} / {limits.maxSessions ?? 'unlimited'}</span>
          </div>
          <p className="text-xs text-slate-500">Energy and pictures refill at {formatReset(usage.resetsAt)} your time.</p>
        </>
      )}

      {!unlimited && <MoreAdventures usage={usage} onRequested={() => setReloadKey(key => key + 1)} />}
    </section>
  );
};
