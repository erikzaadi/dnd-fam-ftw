import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, switchNamespace } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { SiteHeader } from '../components/SiteHeader';
import { DmFooter } from '../components/DmFooter';

import type { SessionNamespace, SessionNamespacesResponse } from '../types';

// 'login': choosing a realm while signing in (pending cookie).
// 'session': already signed in, but the active realm was removed; pick another one.
type PickerMode = 'login' | 'session';
type RealmChoice = Pick<SessionNamespace, 'id' | 'name'>;

export const NamespacePicker = () => {
  const [namespaces, setNamespaces] = useState<RealmChoice[]>([]);
  const [mode, setMode] = useState<PickerMode>('login');
  const [noRealms, setNoRealms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const navigate = useNavigate();
  const { refetch, logout } = useAuth();

  useEffect(() => {
    const load = async () => {
      const pending = await apiFetch('/auth/namespaces');
      if (pending.ok) {
        const data = await pending.json() as { namespaces: RealmChoice[] };
        setNamespaces(data.namespaces);
        return;
      }
      const session = await apiFetch('/auth/session/namespaces');
      if (!session.ok) {
        setError('Your session has expired. Please sign in again.');
        return;
      }
      const data = await session.json() as SessionNamespacesResponse;
      setMode('session');
      setNamespaces(data.namespaces);
      setNoRealms(data.namespaces.length === 0);
    };
    load().catch(() => setError('Failed to load namespaces. Please try again.'));
  }, []);

  const select = async (namespaceId: string) => {
    setSelecting(namespaceId);
    if (mode === 'session') {
      if (!await switchNamespace(namespaceId)) {
        setError('Could not enter that realm. Please try again.');
        setSelecting(null);
      }
      return;
    }
    try {
      const res = await apiFetch('/auth/select-namespace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespaceId }),
      });
      if (!res.ok) {
        setError('Failed to select namespace. Please sign in again.');
        setSelecting(null);
        return;
      }
      await refetch();
      navigate('/');
    } catch {
      setError('Failed to select namespace. Please try again.');
      setSelecting(null);
    }
  };

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />
      <div className="flex-1 flex items-center justify-center px-4 relative z-[10]">
        <div className="bg-slate-900/80 border-2 border-slate-800 rounded-[32px] p-8 max-w-sm w-full space-y-6 text-center">
          <div>
            <div className="text-4xl mb-2">🗺</div>
            <h2 className="text-2xl font-display font-black text-amber-400 italic tracking-tighter">Choose Your Realm</h2>
            <p className="text-slate-400 text-sm mt-2">
              {mode === 'session'
                ? 'You no longer have access to the realm you were in. Pick another one to keep playing.'
                : 'You have access to multiple adventure groups. Which one are you joining today?'}
            </p>
          </div>

          {error && (
            <div className="bg-rose-950/60 border border-rose-800/60 rounded-2xl px-4 py-3 text-rose-300 text-sm">
              {error}
            </div>
          )}

          {namespaces.length > 0 && (
            <div className="space-y-3">
              {namespaces.map(ns => (
                <button
                  key={ns.id}
                  onClick={() => void select(ns.id)}
                  disabled={selecting !== null}
                  className="w-full py-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors text-amber-300 border border-slate-700 hover:border-amber-700"
                >
                  {selecting === ns.id ? 'Entering...' : ns.name}
                </button>
              ))}
            </div>
          )}

          {noRealms && (
            <div className="space-y-4">
              <p className="text-slate-400 text-sm">You are not a member of any realm right now. Ask a realm owner to invite you again.</p>
              <button
                onClick={() => void logout().then(() => navigate('/login'))}
                className="w-full py-3 bg-slate-800 hover:bg-slate-700 rounded-[20px] font-black uppercase italic tracking-tighter transition-colors text-slate-300 border border-slate-700"
              >
                Sign out
              </button>
            </div>
          )}

          {!error && !noRealms && namespaces.length === 0 && (
            <div className="text-slate-500 text-sm">Loading realms...</div>
          )}
        </div>
      </div>
      <DmFooter />
    </div>
  );
};
