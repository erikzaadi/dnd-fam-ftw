import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DmFooter } from '../components/DmFooter';
import { SiteHeader } from '../components/SiteHeader';
import { apiFetch } from '../lib/api';

export const CreateSession = () => {
  const [worldDescription, setWorldDescription] = useState("");
  const [difficulty, setDifficulty] = useState("normal");
  const [useLocalAI, setUseLocalAI] = useState(() => {
    const stored = localStorage.getItem('useLocalAI');
    if (stored !== null) {
      return stored === 'true';
    }
    return false; // backend default applied on load below
  });
  const [showWorldDescription, setShowWorldDescription] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (localStorage.getItem('useLocalAI') === null) {
      apiFetch('/settings').then(r => r.json()).then(s => setUseLocalAI(s.defaultUseLocalAI));
    }
  }, []);

  const toggleLocalAI = () => {
    const next = !useLocalAI;
    setUseLocalAI(next);
    localStorage.setItem('useLocalAI', String(next));
  };

  const createSession = async () => {
    setIsLoading(true);
    setError(null);
    const res = await apiFetch('/session/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldDescription, difficulty, useLocalAI })
    });
    const data = await res.json();
    setIsLoading(false);
    if (res.status === 429) {
      setError(data.message ?? 'The AI is busy, please try again.');
      return;
    }
    if (res.status === 403 && data.error === 'session_limit') {
      setError(data.message ?? 'Session limit reached for this group.');
      return;
    }
    navigate(`/session/${data.id}/assembly`);
  };

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 min-h-0">
        <div className="bg-slate-900/80 backdrop-blur-sm p-8 md:p-12 rounded-[60px] border-2 border-slate-800 shadow-2xl max-w-2xl w-full mx-auto text-center space-y-8 relative z-[10]">
          <h3 className="text-4xl font-display font-black uppercase tracking-tighter text-amber-500 italic">New Journey</h3>
          <div className="flex gap-2 justify-center">
            {['easy', 'normal', 'hard'].map(d => (
              <button key={d} onClick={() => setDifficulty(d)} className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${difficulty === d ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-500'}`}>{d}</button>
            ))}
          </div>
          <div className="flex justify-center">
            <button
              onClick={toggleLocalAI}
              className={`px-4 py-2 rounded-xl border font-black text-xs tracking-widest uppercase transition-all ${useLocalAI ? 'border-purple-500 text-purple-400 bg-purple-500/10' : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-400'}`}
            >
              {useLocalAI ? '🏠 Local AI' : '☁️ Cloud AI'}
            </button>
          </div>
          {showWorldDescription ? (
            <textarea 
              placeholder="Describe the world..." 
              value={worldDescription}
              onChange={e => setWorldDescription(e.target.value)}
              className="w-full p-6 bg-black/40 rounded-[32px] border-2 border-slate-800 text-lg focus:border-amber-500/50 outline-none resize-none h-40"
            />
          ) : (
            <button onClick={() => setShowWorldDescription(true)} className="px-8 py-3 bg-slate-800 hover:bg-slate-700 rounded-2xl text-xs font-black uppercase tracking-widest">+ Add World Description</button>
          )}
          {error && (
            <div className="flex items-center justify-between gap-4 px-6 py-3 bg-rose-950/60 border border-rose-700 rounded-2xl text-rose-300 text-sm">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-200 font-black">✕</button>
            </div>
          )}
          <button onClick={createSession} disabled={isLoading} className="w-full py-8 bg-amber-600 hover:bg-amber-500 rounded-[32px] text-4xl font-black shadow-[0_12px_0_rgb(146,64,14)] transition-all uppercase italic tracking-tighter">
            {isLoading ? 'FORGING...' : 'NEXT: ASSEMBLE HEROES'}
          </button>
        </div>
      </div>
      <DmFooter />
    </div>
  );
};