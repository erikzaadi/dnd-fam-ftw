import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DmFooter } from '../components/DmFooter';
import { SiteHeader } from '../components/SiteHeader';
import { apiFetch } from '../lib/api';

const DIFFICULTY_INFO: Record<string, { color: string; desc: string }> = {
  easy: { color: 'text-emerald-400', desc: 'Rolls target ~8. Fail = -1 HP. Good for younger players or a chill adventure.' },
  normal: { color: 'text-amber-400', desc: 'Rolls target ~12. Fail = -2 HP. The intended experience.' },
  hard: { color: 'text-rose-400', desc: 'Rolls target ~16. Fail = -3 HP. Punishing. Heroes earn every victory.' },
};

const PACING_INFO: Record<string, string> = {
  cinematic: 'Rich story, world-building, and character moments. Combat is rare and meaningful. Best for long sessions.',
  balanced: 'A mix of story and action. Expect a challenge every 4-5 turns. The default experience.',
  fast: 'High stakes from the start. A fight or challenge appears every 2 turns. Little breathing room.',
  'zug-ma-geddon': 'STRAIGHT TO BATTLE. Every turn is chaos. High tension, always. Not for the faint of heart.',
};

export const CreateSession = () => {
  const [worldDescription, setWorldDescription] = useState("");
  const [dmPrep, setDmPrep] = useState("");
  const [showDmPrep, setShowDmPrep] = useState(false);
  const [difficulty, setDifficulty] = useState("normal");
  const [gameMode, setGameMode] = useState<'cinematic' | 'balanced' | 'fast' | 'zug-ma-geddon'>("balanced");
  const [useLocalAI, setUseLocalAI] = useState(() => {
    const stored = localStorage.getItem('useLocalAI');
    if (stored !== null) {
      return stored === 'true';
    }
    return false;
  });
  const [showWorldDescription, setShowWorldDescription] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLocalAI, setHasLocalAI] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const needsDefaultAI = localStorage.getItem('useLocalAI') === null;
    const fetches: Promise<void>[] = [
      apiFetch('/capabilities').then(r => r.json()).then(c => setHasLocalAI(c.hasLocalAI)),
    ];
    if (needsDefaultAI) {
      fetches.push(apiFetch('/settings').then(r => r.json()).then(s => setUseLocalAI(s.defaultUseLocalAI)));
    }
    Promise.all(fetches);
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
      body: JSON.stringify({ worldDescription, difficulty, useLocalAI, gameMode, dmPrep: dmPrep || undefined })
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

          {/* Difficulty */}
          <div className="flex flex-col gap-3">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Difficulty</span>
            <div className="flex gap-2 justify-center">
              {(['easy', 'normal', 'hard'] as const).map(d => (
                <button key={d} onClick={() => setDifficulty(d)} className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${difficulty === d ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-500'}`}>{d}</button>
              ))}
            </div>
            <div className={`text-xs px-4 py-2.5 bg-black/30 rounded-2xl border border-slate-800 text-left ${DIFFICULTY_INFO[difficulty].color}`}>
              {DIFFICULTY_INFO[difficulty].desc}
            </div>
          </div>

          {/* Game Pacing */}
          <div className="flex flex-col gap-3">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Game Pacing</span>
            <div className="flex flex-wrap gap-2 justify-center">
              {[
                { id: 'cinematic', icon: '🎬', label: 'Cinematic' },
                { id: 'balanced', icon: '⚖️', label: 'Balanced' },
                { id: 'fast', icon: '⚡', label: 'Fast' },
                { id: 'zug-ma-geddon', icon: '💀', label: 'ZUG-MA-GEDDON' },
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => setGameMode(m.id as 'cinematic' | 'balanced' | 'fast' | 'zug-ma-geddon')}
                  className={`flex flex-col items-center px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${gameMode === m.id ? (m.id === 'zug-ma-geddon' ? 'bg-rose-900/20 border-rose-500 text-rose-400' : 'bg-amber-600/10 border-amber-600 text-amber-500') : 'bg-slate-800/50 border-slate-700 text-slate-500'}`}
                >
                  <span className="text-base mb-0.5">{m.icon}</span>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
            <div className={`text-xs px-4 py-2.5 rounded-2xl border text-left ${gameMode === 'zug-ma-geddon' ? 'bg-rose-950/20 border-rose-800/40 text-rose-300' : 'bg-black/30 border-slate-800 text-slate-400'}`}>
              {PACING_INFO[gameMode]}
            </div>
          </div>

          {hasLocalAI && (
            <div className="flex justify-center">
              <button
                onClick={toggleLocalAI}
                className={`px-4 py-2 rounded-xl border font-black text-xs tracking-widest uppercase transition-all ${useLocalAI ? 'border-purple-500 text-purple-400 bg-purple-500/10' : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-400'}`}
              >
                {useLocalAI ? '🏠 Local AI' : '☁️ Cloud AI'}
              </button>
            </div>
          )}
          {showWorldDescription ? (
            <textarea
              placeholder="Describe the realm..."
              value={worldDescription}
              onChange={e => setWorldDescription(e.target.value)}
              className="w-full p-6 bg-black/40 rounded-[32px] border-2 border-slate-800 text-lg focus:border-amber-500/50 outline-none resize-none h-40"
            />
          ) : (
            <button onClick={() => setShowWorldDescription(true)} className="px-8 py-3 bg-slate-800 hover:bg-slate-700 rounded-2xl text-xs font-black uppercase tracking-widest">+ Add Realm Description</button>
          )}
          {showDmPrep ? (
            <textarea
              placeholder="DM prep: describe villains, lore, plot hooks, campaign notes..."
              value={dmPrep}
              onChange={e => setDmPrep(e.target.value)}
              className="w-full p-6 bg-black/40 rounded-[32px] border-2 border-purple-900/40 text-base focus:border-purple-500/50 outline-none resize-none h-32 text-slate-300 placeholder-slate-600"
            />
          ) : (
            <button onClick={() => setShowDmPrep(true)} className="px-8 py-3 bg-slate-800/60 hover:bg-slate-700/60 border border-purple-900/40 hover:border-purple-700/60 rounded-2xl text-xs font-black uppercase tracking-widest text-purple-400 hover:text-purple-300 transition-all">+ DM Prep (Campaign Notes)</button>
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
