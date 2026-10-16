import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import type { DeviceGrantSummary } from '../types';

const formatDate = (ms: number) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' });

const loadTvs = (): Promise<DeviceGrantSummary[]> =>
  apiFetch('/auth/devices')
    .then(res => (res.ok ? res.json() as Promise<DeviceGrantSummary[]> : []))
    .catch(() => []);

// Settings: the TVs this player approved, each with a sign-out, and a way to approve another.
export const SignedInTvs = () => {
  const [tvs, setTvs] = useState<DeviceGrantSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadTvs().then(setTvs);
  }, []);

  const signOut = async (tv: DeviceGrantSummary) => {
    setError(null);
    const res = await apiFetch(`/auth/devices/${encodeURIComponent(tv.id)}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => null);
    if (!res?.ok) {
      setError(`Could not sign out "${tv.label}". Try again.`);
      return;
    }
    setTvs(await loadTvs());
  };

  return (
    <>
      <h2 className="text-lg font-black uppercase tracking-tighter text-amber-500 pt-2">Signed-in TVs</h2>
      {tvs.length === 0 && <p className="text-slate-500 text-sm px-2">No TVs are signed in as you.</p>}
      <ul className="space-y-2">
        {tvs.map(tv => (
          <li key={tv.id} className="flex items-center gap-3 bg-slate-800/60 border border-slate-700 rounded-2xl px-4 py-3">
            <span aria-hidden="true">📺</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-200 truncate">{tv.label}</div>
              <div className="text-xs text-slate-500">Last used {formatDate(tv.lastSeenAt)}, signs out by {formatDate(tv.expiresAt)}</div>
            </div>
            <button
              onClick={() => void signOut(tv)}
              className="px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-slate-300 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
            >
              Sign out
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-rose-300 text-sm px-2">{error}</p>}
      <Link
        to="/link"
        className="block w-full py-3 bg-slate-800 hover:bg-slate-700 border-2 border-slate-700 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors text-slate-300 text-sm text-center"
      >
        Sign in a TV
      </Link>
    </>
  );
};
