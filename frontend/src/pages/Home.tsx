import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DmFooter } from '../components/DmFooter';
import { SiteHeader } from '../components/SiteHeader';
import { apiFetch, imgSrc } from '../lib/api';
import type { SessionPreview } from '../types';

const DIFFICULTY_INFO: Record<string, { color: string; label: string }> = {
  easy: { color: 'text-emerald-400', label: 'Easy' },
  normal: { color: 'text-amber-400', label: 'Normal' },
  hard: { color: 'text-rose-400', label: 'Hard' },
};

const PACING_LABELS: Record<string, { icon: string; label: string }> = {
  cinematic: { icon: '🎬', label: 'Cinematic' },
  balanced: { icon: '⚖️', label: 'Balanced' },
  fast: { icon: '⚡', label: 'Fast' },
  'zug-ma-geddon': { icon: '💀', label: 'ZUG-MA-GEDDON' },
};

const EditSessionModal = ({
  sessionId,
  initialDifficulty,
  initialGameMode,
  initialDmPrep,
  onSave,
  onCancel,
}: {
  sessionId: string;
  initialDifficulty: string;
  initialGameMode: string;
  initialDmPrep?: string;
  onSave: (difficulty: string, gameMode: string, dmPrep: string) => void;
  onCancel: () => void;
}) => {
  const [difficulty, setDifficulty] = useState(initialDifficulty);
  const [gameMode, setGameMode] = useState(initialGameMode);
  const [dmPrep, setDmPrep] = useState(initialDmPrep ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await apiFetch(`/session/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty, gameMode, dmPrep: dmPrep || undefined }),
    });
    setSaving(false);
    onSave(difficulty, gameMode, dmPrep);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-[32px] p-6 max-w-md w-full shadow-2xl space-y-5">
        <h3 className="text-lg font-black uppercase tracking-tighter text-amber-400 italic">Edit Realm</h3>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Difficulty</span>
          <div className="flex gap-2">
            {(['easy', 'normal', 'hard'] as const).map(d => (
              <button
                key={d}
                onClick={() => setDifficulty(d)}
                className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${difficulty === d ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-500'}`}
              >
                {d}
              </button>
            ))}
          </div>
          {DIFFICULTY_INFO[difficulty] && (
            <p className={`text-xs ${DIFFICULTY_INFO[difficulty].color}`}>{DIFFICULTY_INFO[difficulty].label}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Game Pacing</span>
          <div className="flex flex-wrap gap-2">
            {Object.entries(PACING_LABELS).map(([id, { icon, label }]) => (
              <button
                key={id}
                onClick={() => setGameMode(id)}
                className={`flex flex-col items-center px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${gameMode === id ? (id === 'zug-ma-geddon' ? 'bg-rose-900/20 border-rose-500 text-rose-400' : 'bg-amber-600/10 border-amber-600 text-amber-500') : 'bg-slate-800/50 border-slate-700 text-slate-500'}`}
              >
                <span className="text-sm mb-0.5">{icon}</span>
                <span className="text-[8px]">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">DM Prep Notes</span>
          <textarea
            value={dmPrep}
            onChange={e => setDmPrep(e.target.value)}
            rows={4}
            placeholder="Lore, villains, locations, plot hooks..."
            className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-amber-600/60 transition-colors"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-400 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-2xl text-xs font-black uppercase tracking-widest text-white transition-all"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

const WorldCard = ({
  session,
  onEnter,
  onDelete,
  onEdit,
}: {
  session: SessionPreview;
  onEnter: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) => {
  const hasDetails = session.party.length > 0 || session.worldDescription || session.storySummary;

  return (
    <div className="bg-black/40 rounded-[20px] border-2 border-slate-800 overflow-hidden hover:border-slate-700 transition-colors h-full flex flex-col">
      {/* Header row */}
      <div className="flex items-center gap-2 p-4 flex-shrink-0">
        <span className="flex-1 text-left text-amber-400 font-black text-xl tracking-tight truncate">
          {session.displayName}
        </span>
        <button
          onClick={onEdit}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-600 hover:text-amber-400 hover:bg-amber-500/10 text-sm transition-colors flex-shrink-0"
          aria-label="Edit"
        >
          ✎
        </button>
        <button
          onClick={onDelete}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-600 hover:text-rose-500 hover:bg-rose-500/10 text-sm font-black transition-colors flex-shrink-0"
          aria-label="Delete"
        >
          ✕
        </button>
      </div>

      {/* Scrollable details */}
      {hasDetails && (
        <div className="border-t border-slate-800 px-4 pt-3 space-y-3 flex-1 overflow-y-auto min-h-0 max-h-56">
          {session.party.length > 0 && (
            <div className="flex flex-wrap gap-2 flex-col">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Adventurers ({session.party.length})</p>
              <div className="flex flex-wrap gap-2">
                {session.party.map(c => (
                  <div key={c.id} className="flex items-center gap-2 bg-slate-800/60 rounded-xl px-2 py-1.5 border border-slate-700/50">
                    {c.avatarUrl && (
                      <img src={imgSrc(c.avatarUrl)} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" alt={c.name} />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-black text-slate-200 leading-tight truncate">{c.name}</div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wide leading-tight">{c.class}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {session.worldDescription && (
            <p className="text-sm text-slate-400 italic leading-relaxed">{session.worldDescription}</p>
          )}
          {session.storySummary && (
            <p className="text-sm text-slate-500 leading-relaxed border-l-2 border-slate-700 pl-3">{session.storySummary}</p>
          )}
        </div>
      )}
      {!hasDetails && <div className="flex-1" />}

      {/* Enter button - always pinned at bottom */}
      <div className="px-4 py-4 flex-shrink-0 border-t border-slate-800/60">
        <button
          onClick={onEnter}
          className="w-full py-3 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-600/40 hover:border-amber-500/60 rounded-xl font-black uppercase tracking-widest text-amber-400 text-sm transition-all"
        >
          Enter Realm →
        </button>
      </div>
    </div>
  );
};

export const Home = () => {
  const [activeSessions, setActiveSessions] = useState<SessionPreview[]>([]);
  const [sessionLimit, setSessionLimit] = useState<{ max: number; current: number } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{message: string, onConfirm: () => void} | null>(null);
  const [editSession, setEditSession] = useState<{ id: string; difficulty: string; gameMode: string; dmPrep?: string } | null>(null);
  const navigate = useNavigate();

  const loadSessions = () => {
    apiFetch('/sessions')
      .then(res => res.json())
      .then(data => setActiveSessions(data as SessionPreview[]));
  };

  const loadLimits = () => {
    apiFetch('/namespace/limits')
      .then(res => res.json())
      .then((data: { maxSessions: number | null; sessionCount: number }) => {
        if (data.maxSessions !== null) {
          setSessionLimit({ max: data.maxSessions, current: data.sessionCount });
        }
      })
      .catch(() => { /* limits unavailable, proceed without */ });
  };

  useEffect(() => {
    loadSessions();
    loadLimits();
  }, []);

  const deleteSession = (id: string, displayName: string) => {
    setConfirmDialog({
      message: `Permanently destroy "${displayName}"?`,
      onConfirm: async () => {
        await apiFetch(`/session/${id}`, { method: 'DELETE' });
        loadSessions();
        loadLimits();
        setConfirmDialog(null);
      }
    });
  };

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {editSession && (
        <EditSessionModal
          sessionId={editSession.id}
          initialDifficulty={editSession.difficulty}
          initialGameMode={editSession.gameMode}
          initialDmPrep={editSession.dmPrep}
          onSave={(difficulty, gameMode, dmPrep) => {
            setActiveSessions(prev => prev.map(s =>
              s.id === editSession.id ? { ...s, difficulty, gameMode, dmPrep: dmPrep || undefined } : s
            ));
            setEditSession(null);
          }}
          onCancel={() => setEditSession(null)}
        />
      )}

      <SiteHeader />

      <div className="flex-1 flex flex-col gap-4 px-4 md:px-8 pt-4 pb-6 relative z-[10] min-h-0 w-full max-w-6xl mx-auto">
        {/* New world / limit button - full width */}
        {sessionLimit && sessionLimit.current >= sessionLimit.max ? (
          <div className="px-8 py-5 bg-slate-800 border-2 border-slate-700 rounded-[32px] text-center flex-shrink-0">
            <p className="text-slate-400 font-black uppercase italic tracking-tighter text-xl md:text-2xl">REALM LIMIT REACHED</p>
            <p className="text-slate-500 text-sm mt-1">{sessionLimit.current} / {sessionLimit.max} realms - delete one to start another</p>
          </div>
        ) : (
          <button
            onClick={() => navigate('/create-session')}
            className="px-8 py-5 md:py-6 bg-amber-600 hover:bg-amber-500 rounded-[32px] text-2xl md:text-4xl font-black shadow-[0_12px_0_rgb(146,64,14)] transition-all uppercase italic tracking-tighter w-full flex-shrink-0 flex items-center justify-center gap-4"
          >
            <img
              src={imgSrc('/images/icon_dice.png')}
              className="w-10 h-10 md:w-14 md:h-14 rounded-full object-cover animate-dice-shake flex-shrink-0"
              alt=""
            />
            START A NEW REALM{sessionLimit ? ` (${sessionLimit.current}/${sessionLimit.max})` : ''}
          </button>
        )}

        {/* Sessions grid */}
        {activeSessions.length > 0 ? (
          <div className="flex-1 flex flex-col min-h-0 gap-2">
            <h3 className="text-3xl md:text-4xl font-black uppercase tracking-tighter text-white italic flex-shrink-0">Active Realms 🌍</h3>
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pb-2 auto-rows-fr">
                {activeSessions.map(sess => (
                  <WorldCard
                    key={sess.id}
                    session={sess}
                    onEnter={() => navigate(`/session/${sess.id}/recap`)}
                    onDelete={() => deleteSession(sess.id, sess.displayName)}
                    onEdit={() => setEditSession({ id: sess.id, difficulty: sess.difficulty, gameMode: sess.gameMode, dmPrep: sess.dmPrep })}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        <div className="flex gap-4 flex-shrink-0">
          <button
            onClick={() => navigate('/how-to-play')}
            className="flex-1 px-8 py-4 bg-slate-800 hover:bg-slate-700 rounded-[24px] text-base font-black uppercase italic tracking-tighter transition-colors border-2 border-slate-700"
          >
            📖 How to Play
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="flex-1 px-8 py-4 bg-slate-800 hover:bg-slate-700 rounded-[24px] text-base font-black uppercase italic tracking-tighter transition-colors border-2 border-slate-700"
          >
            ⚙ Settings
          </button>
        </div>
      </div>

      <DmFooter />
    </div>
  );
};
