import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export const CreateSession = () => {
  const [worldDescription, setWorldDescription] = useState("");
  const [difficulty, setDifficulty] = useState("normal");
  const [showWorldDescription, setShowWorldDescription] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const createSession = async () => {
    setIsLoading(true);
    setError(null);
    const res = await fetch('/api/session/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldDescription, difficulty })
    });
    const data = await res.json();
    setIsLoading(false);
    if (res.status === 429) {
      setError(data.message ?? 'The AI is busy, please try again.');
      return;
    }
    navigate(`/session/${data.id}/assembly`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-8">
      <div className="bg-slate-900 p-12 rounded-[60px] border-2 border-slate-800 shadow-2xl max-w-2xl w-full text-center space-y-8">
        <h3 className="text-4xl font-display font-black uppercase tracking-tighter text-amber-500 italic">New Journey</h3>
        <div className="flex gap-2 justify-center">
          {['easy', 'normal', 'hard'].map(d => (
            <button key={d} onClick={() => setDifficulty(d)} className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${difficulty === d ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-500'}`}>{d}</button>
          ))}
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
  );
};