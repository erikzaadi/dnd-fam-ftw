import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { apiFetch } from '../lib/api';
import type { NamespaceUsageResponse } from '../types';

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

// Tier, today's usage, and limits for the signed-in group. Shown in Settings.
export const YourRealm = ({ children }: { children?: (usage: NamespaceUsageResponse) => ReactNode }) => {
  const [usage, setUsage] = useState<NamespaceUsageResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiFetch('/namespace/usage')
      .then(async res => {
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        setUsage(await res.json() as NamespaceUsageResponse);
      })
      .catch(() => setFailed(true));
  }, []);

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

      {children?.(usage)}
    </section>
  );
};
