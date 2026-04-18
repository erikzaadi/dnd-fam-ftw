import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { TurnResult, Session, Character } from '../types';
import { api, imgSrc } from '../lib/api';
import { FullscreenImage } from '../components/FullscreenImage';
import { DmFooter } from '../components/DmFooter';
import { SiteHeader } from '../components/SiteHeader';

type Mode = 'choose' | 'tldr' | 'movie';

const MOVIE_INTERVAL_MS = 5000;

// ── TLDR ────────────────────────────────────────────────────────────────────

const TldrView = ({ sessionId, onEnter }: { sessionId: string; onEnter: () => void }) => {
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    fetch(api(`/session/${sessionId}/summary`))
      .then(r => r.json())
      .then(d => setSummary(d.summary));
  }, [sessionId]);

  return (
    <div className="flex flex-col items-center gap-8 max-w-2xl w-full animate-in fade-in duration-500 relative z-[10]">
      <h2 className="text-2xl font-display font-black text-amber-500 uppercase tracking-widest">The Story So Far</h2>
      {summary ? (
        <p className="font-narrative text-xl text-slate-200 leading-relaxed italic text-center">{summary}</p>
      ) : (
        <p className="text-amber-500 animate-pulse font-black uppercase tracking-widest">Consulting the chronicles...</p>
      )}
      {summary && (
        <button onClick={onEnter} className="px-12 py-5 bg-amber-600 hover:bg-amber-500 rounded-[28px] font-black uppercase italic tracking-tighter text-2xl shadow-[0_8px_0_rgb(146,64,14)] transition-all animate-in fade-in duration-500">
          Enter World
        </button>
      )}
    </div>
  );
};

// ── MOVIE ───────────────────────────────────────────────────────────────────

const MovieView = ({ history, party, onEnter }: { history: TurnResult[]; party: Character[]; onEnter: () => void }) => {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [fullscreenUrl, setFullscreenUrl] = useState<string | null>(null);
  const turn = history[idx];
  const isLast = idx === history.length - 1;
  const actor = turn.characterId ? party.find(c => c.id === turn.characterId) : null;

  useEffect(() => {
    if (!playing || isLast) {
      return;
    }
    const t = setTimeout(() => setIdx(i => i + 1), MOVIE_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [idx, playing, isLast]);

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-3xl animate-in fade-in duration-500 relative z-[10]">
      {fullscreenUrl && <FullscreenImage url={fullscreenUrl} onClose={() => setFullscreenUrl(null)} />}
      {/* Progress dots */}
      <div className="flex gap-1.5 flex-wrap justify-center">
        {history.map((_, i) => (
          <button
            key={i}
            onClick={() => {
              setIdx(i); setPlaying(false); 
            }}
            className={`w-2 h-2 rounded-full transition-all ${i === idx ? 'bg-amber-500 w-4' : i < idx ? 'bg-slate-600' : 'bg-slate-800'}`}
          />
        ))}
      </div>

      {/* Scene */}
      <div key={idx} className="w-full animate-in fade-in zoom-in-95 duration-700">
        {turn.imageUrl ? (
          <div
            className="w-full h-48 md:h-72 rounded-[40px] border border-slate-800 shadow-2xl overflow-hidden cursor-zoom-in"
            onClick={() => {
              setFullscreenUrl(imgSrc(turn.imageUrl)); setPlaying(false); 
            }}
          >
            <img src={imgSrc(turn.imageUrl)} className="w-full h-full object-cover animate-ken-burns" />
          </div>
        ) : (
          <div className="w-full h-48 md:h-72 rounded-[40px] border border-slate-800 overflow-hidden relative">
            <img src={imgSrc('/api/images/dm_thinking.png')} className="w-full h-full object-cover object-center opacity-20" />
            <div className="absolute inset-0 bg-slate-900/60" />
          </div>
        )}
      </div>

      {/* Narration */}
      <div key={`n-${idx}`} className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 text-center px-4">
        {actor && (
          <div className="flex items-center justify-center gap-2 mb-3">
            <img src={imgSrc(actor.avatarUrl)} className="w-8 h-8 rounded-full object-cover border border-slate-600" />
            <span className="text-xs font-black uppercase tracking-widest text-slate-400">{actor.name}</span>
          </div>
        )}
        {turn.lastAction && (
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-500/70 mb-2">
            "{turn.lastAction.actionAttempt}" - {turn.lastAction.actionResult.success ? '✓ success' : '✗ failed'}
          </p>
        )}
        <p className="font-narrative text-lg text-slate-200 italic leading-relaxed">{turn.narration}</p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <button onClick={() => {
          setIdx(i => Math.max(0, i - 1)); setPlaying(false); 
        }} disabled={idx === 0} className="px-4 py-2 bg-slate-800 rounded-xl font-black text-sm disabled:opacity-30">←</button>
        <button onClick={() => setPlaying(p => !p)} className="px-4 py-2 bg-slate-800 rounded-xl font-black text-sm w-20">
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => {
          setIdx(i => Math.min(history.length - 1, i + 1)); setPlaying(false); 
        }} disabled={isLast} className="px-4 py-2 bg-slate-800 rounded-xl font-black text-sm disabled:opacity-30">→</button>
      </div>

      {isLast && (
        <button onClick={onEnter} className="px-12 py-5 bg-amber-600 hover:bg-amber-500 rounded-[28px] font-black uppercase italic tracking-tighter text-2xl shadow-[0_8px_0_rgb(146,64,14)] transition-all animate-in fade-in duration-500">
          Enter World
        </button>
      )}
    </div>
  );
};

// ── PAGE ─────────────────────────────────────────────────────────────────────

export const SessionRecap = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('choose');
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<TurnResult[]>([]);

  const enter = useCallback(() => navigate(`/session/${id}`), [id, navigate]);

  const toggleSavingsMode = async () => {
    if (!session) {
      return;
    }
    const enabled = !session.savingsMode;
    await fetch(api(`/session/${session.id}/savings-mode`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    setSession({ ...session, savingsMode: enabled });
  };

  useEffect(() => {
    if (!id) {
      return;
    }
    Promise.all([
      fetch(api(`/session/${id}`)).then(r => r.json()),
      fetch(api(`/session/${id}/history`)).then(r => r.json()),
    ]).then(([s, h]) => {
      setSession(s);
      setHistory(h);
      if (!h.length) {
        enter();
      }
    });
  }, [id, enter]);

  if (!session) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-amber-500 animate-pulse font-black uppercase tracking-widest">Loading...</div>;
  }

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-4 md:px-8 py-6 gap-8 md:gap-10 min-h-0">
        <div className="flex items-center justify-between w-full max-w-3xl relative z-[10]">
          <h1 className="text-xl md:text-3xl font-display font-black text-amber-500 italic tracking-tight">{session.displayName}</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSavingsMode}
              title={session.savingsMode ? 'Images off - click to enable' : 'Images on - click to disable'}
              className={`px-3 py-2 rounded-xl border font-black text-xs tracking-widest uppercase transition-all cursor-pointer ${session.savingsMode ? 'border-amber-500 text-amber-400 bg-amber-500/10' : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-400'}`}
            >
              {session.savingsMode ? '🪙 Saving' : '🖼 Images'}
            </button>
            <Link to="/" className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 uppercase font-black text-xs tracking-widest transition-all">Exit World</Link>
          </div>
        </div>

        {mode === 'choose' && (
          <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in duration-500 relative z-[10]">
            <p className="text-slate-400 font-black uppercase tracking-widest text-sm">How would you like to catch up?</p>
            <div className="flex gap-4 md:gap-6">
              <button onClick={() => setMode('tldr')} className="flex flex-col items-center gap-3 p-6 md:p-8 bg-slate-900 hover:bg-slate-800 rounded-[32px] border border-slate-700 hover:border-amber-500/50 transition-all w-36 md:w-44">
                <span className="text-4xl">📜</span>
                <span className="font-black uppercase tracking-widest text-sm">TLDR</span>
                <span className="text-xs text-slate-500 text-center">AI summary of the adventure</span>
              </button>
              <button onClick={() => setMode('movie')} className="flex flex-col items-center gap-3 p-6 md:p-8 bg-slate-900 hover:bg-slate-800 rounded-[32px] border border-slate-700 hover:border-amber-500/50 transition-all w-36 md:w-44">
                <span className="text-4xl">🎬</span>
                <span className="font-black uppercase tracking-widest text-sm">Movie</span>
                <span className="text-xs text-slate-500 text-center">Relive each turn with scenes</span>
              </button>
            </div>
            <button onClick={enter} className="text-slate-500 hover:text-slate-300 font-black uppercase text-xs tracking-widest transition-colors">Skip → Jump straight in</button>
          </div>
        )}

        {mode === 'tldr' && <TldrView sessionId={id!} onEnter={enter} />}
        {mode === 'movie' && history.length > 0 && <MovieView history={history} party={session.party} onEnter={enter} />}
      </div>
      <DmFooter />
    </div>
  );
};
