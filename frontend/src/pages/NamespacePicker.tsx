import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface Namespace {
  id: string;
  name: string;
}

export const NamespacePicker = () => {
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const navigate = useNavigate();
  const { refetch } = useAuth();

  useEffect(() => {
    apiFetch('/auth/namespaces')
      .then(async res => {
        if (!res.ok) {
          setError('Your session has expired. Please sign in again.');
          return;
        }
        const data = await res.json() as { namespaces: Namespace[] };
        setNamespaces(data.namespaces);
      })
      .catch(() => setError('Failed to load namespaces. Please try again.'));
  }, []);

  const select = async (namespaceId: string) => {
    setSelecting(namespaceId);
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
      refetch();
      navigate('/');
    } catch {
      setError('Failed to select namespace. Please try again.');
      setSelecting(null);
    }
  };

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col items-center justify-center px-4">
      <div className="bg-slate-900/80 border-2 border-slate-800 rounded-[32px] p-8 max-w-sm w-full space-y-6 text-center">
        <div>
          <div className="text-4xl mb-2">🗺</div>
          <h2 className="text-2xl font-display font-black text-amber-400 italic tracking-tighter">Choose Your Realm</h2>
          <p className="text-slate-400 text-sm mt-2">You have access to multiple adventure groups. Which one are you joining today?</p>
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

        {!error && namespaces.length === 0 && (
          <div className="text-slate-500 text-sm">Loading realms...</div>
        )}
      </div>
    </div>
  );
};
