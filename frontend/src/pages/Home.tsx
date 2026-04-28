import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DmFooter } from '../components/DmFooter';
import { FullscreenImage } from '../components/FullscreenImage';
import { SiteHeader } from '../components/SiteHeader';
import { apiFetch, imgSrc } from '../lib/api';
import { getSessionEntryPath } from '../lib/sessionRoute';
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
  sessionName,
  sessionId,
  initialDifficulty,
  initialGameMode,
  initialDmPrep,
  initialWorldDescription,
  onSave,
  onCancel,
}: {
  sessionName: string;
  sessionId: string;
  initialDifficulty: string;
  initialGameMode: string;
  initialDmPrep?: string;
  initialWorldDescription?: string;
  onSave: (difficulty: string, gameMode: string, dmPrep: string, worldDescription: string) => void;
  onCancel: () => void;
}) => {
  const [difficulty, setDifficulty] = useState(initialDifficulty);
  const [gameMode, setGameMode] = useState(initialGameMode);
  const [dmPrep, setDmPrep] = useState(initialDmPrep ?? '');
  const [worldDescription, setWorldDescription] = useState(initialWorldDescription ?? '');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const save = async () => {
    setSaving(true);
    await apiFetch(`/session/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty, gameMode, dmPrep: dmPrep || undefined, worldDescription: worldDescription || undefined }),
    });
    setSaving(false);
    onSave(difficulty, gameMode, dmPrep, worldDescription);
  };

  const regenerateDmPrep = async () => {
    setRegenerating(true);
    try {
      const res = await apiFetch(`/session/${sessionId}/regenerate-dm-prep`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json() as { dmPrep: string };
        setDmPrep(data.dmPrep);
      }
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-[32px] p-6 max-w-md w-full shadow-2xl space-y-5">
        <h3 className="text-lg font-black uppercase tracking-tighter text-amber-400 italic">Edit Realm - {sessionName}</h3>

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
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">World Description</span>
          <textarea
            value={worldDescription}
            onChange={e => setWorldDescription(e.target.value)}
            rows={2}
            placeholder="Describe the world, setting, or tone..."
            className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-amber-600/60 transition-colors"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">DM Prep Notes</span>
            <button
              onClick={regenerateDmPrep}
              disabled={regenerating}
              className="text-[9px] font-black uppercase tracking-widest text-amber-500 hover:text-amber-400 disabled:opacity-40 transition-colors"
            >
              {regenerating ? 'Generating...' : 'AI Generate'}
            </button>
          </div>
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
  onAssemble,
  enterRef,
}: {
  session: SessionPreview;
  onEnter: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onAssemble: () => void;
  enterRef?: (el: HTMLButtonElement | null) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [fullscreenPreview, setFullscreenPreview] = useState(false);
  const hasDetails = session.party.length > 0 || session.worldDescription || session.storySummary;
  const previewSrc = session.previewImageUrl ? imgSrc(session.previewImageUrl) : imgSrc('/images/default_scene.png');

  return (
    <div className="bg-black/40 rounded-[20px] border-2 border-slate-800 hover:border-slate-700 transition-colors flex flex-col relative">
      {fullscreenPreview && (
        <FullscreenImage url={previewSrc} onClose={() => setFullscreenPreview(false)} />
      )}
      {/* Always-visible row - click anywhere outside buttons to toggle */}
      <div
        className="flex items-center gap-2 px-3 py-3 flex-shrink-0 cursor-pointer"
        onClick={() => hasDetails && setExpanded(e => !e)}
      >
        {/* Preview image - click opens fullscreen */}
        <img
          src={previewSrc}
          alt=""
          onClick={e => {
            e.stopPropagation(); setFullscreenPreview(true); 
          }}
          className="w-12 h-12 rounded-xl object-cover flex-shrink-0 border border-slate-700 cursor-zoom-in hover:border-amber-500/60 transition-colors"
        />
        <span className="flex-1 text-left text-amber-400 font-black text-base tracking-tight truncate flex items-center gap-2 min-w-0">
          {session.displayName}
          {session.gameOver && (
            <span className="text-[9px] font-black uppercase tracking-widest text-rose-500 border border-rose-700/50 bg-rose-900/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
              FALLEN
            </span>
          )}
        </span>
        {/* Info toggle */}
        {hasDetails && (
          <div className="relative group flex-shrink-0">
            <button
              onClick={e => {
                e.stopPropagation(); setExpanded(v => !v); 
              }}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 text-xs transition-colors"
              aria-label={expanded ? 'Collapse' : 'Info'}
            >
              {expanded ? '▲' : '▼'}
            </button>
            <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-black bg-slate-800 border border-slate-700 rounded-lg text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
              {expanded ? 'Collapse details' : 'Show details'}
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-700" />
            </span>
          </div>
        )}
        {/* Enter */}
        {session.gameOver ? (
          <div className="relative group flex-shrink-0">
            <button
              ref={enterRef}
              onClick={e => {
                e.stopPropagation(); onEnter(); 
              }}
              className="px-3 py-1.5 bg-rose-900/20 hover:bg-rose-900/30 border border-rose-700/40 rounded-lg font-black uppercase tracking-widest text-rose-500 text-[10px] transition-all"
            >
              Chronicle
            </button>
            <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-black bg-slate-800 border border-slate-700 rounded-lg text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
              View session recap
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-700" />
            </span>
          </div>
        ) : (
          <div className="relative group flex-shrink-0">
            <button
              ref={enterRef}
              onClick={e => {
                e.stopPropagation(); onEnter(); 
              }}
              className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-600/40 rounded-lg font-black uppercase tracking-widest text-amber-400 text-[10px] transition-all"
            >
              Enter →
            </button>
            <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-black bg-slate-800 border border-slate-700 rounded-lg text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
              Enter realm
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-700" />
            </span>
          </div>
        )}
        {/* Assemble Heroes - icon button with tooltip */}
        <div className="relative group flex-shrink-0">
          <button
            onClick={e => {
              e.stopPropagation(); onAssemble(); 
            }}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 text-sm transition-colors"
            aria-label="Manage Heroes"
          >
            ⚔
          </button>
          <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-black bg-slate-800 border border-slate-700 rounded-lg text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
            Manage heroes
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-700" />
          </span>
        </div>
        <div className="relative group flex-shrink-0">
          <button
            onClick={e => {
              e.stopPropagation(); onEdit(); 
            }}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-600 hover:text-amber-400 hover:bg-amber-500/10 text-sm transition-colors"
            aria-label="Edit realm"
          >
            ✎
          </button>
          <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-black bg-slate-800 border border-slate-700 rounded-lg text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
            Edit realm
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-700" />
          </span>
        </div>
        <div className="relative group flex-shrink-0">
          <button
            onClick={e => {
              e.stopPropagation(); onDelete(); 
            }}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-600 hover:text-rose-500 hover:bg-rose-500/10 text-sm font-black transition-colors"
            aria-label="Delete realm"
          >
            ✕
          </button>
          <span className="absolute top-full right-0 mt-1.5 px-2 py-1 text-[10px] font-black bg-slate-800 border border-slate-700 rounded-lg text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
            Delete realm
            <span className="absolute bottom-full right-3 border-4 border-transparent border-b-slate-700" />
          </span>
        </div>
      </div>

      {/* Collapsible details */}
      {expanded && hasDetails && (
        <div className="border-t border-slate-800 px-4 pt-3 pb-3">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="min-w-0 flex-1 space-y-3">
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
            <button
              type="button"
              onClick={e => {
                e.stopPropagation(); setFullscreenPreview(true);
              }}
              className="relative md:w-60 lg:w-72 aspect-[16/10] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 flex-shrink-0 cursor-zoom-in group"
              aria-label="Open realm preview"
            >
              <img
                src={previewSrc}
                alt=""
                className="absolute inset-0 w-full h-full object-cover animate-ken-burns"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const Home = () => {
  const [activeSessions, setActiveSessions] = useState<SessionPreview[]>([]);
  const [sessionLimit, setSessionLimit] = useState<{ max: number; current: number } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{message: string, onConfirm: () => void} | null>(null);
  const [editSession, setEditSession] = useState<{ id: string; displayName: string; difficulty: string; gameMode: string; dmPrep?: string; worldDescription?: string } | null>(null);
  const navigate = useNavigate();
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (activeSessions.length === 0 || editSession) {
        return;
      }
      const isNext = e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'l' || e.key === 'j';
      const isPrev = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'h' || e.key === 'k';
      if (!isNext && !isPrev) {
        return;
      }
      const current = cardRefs.current.findIndex(el => el === document.activeElement);
      if (isNext) {
        e.preventDefault();
        const next = current === -1 ? 0 : Math.min(activeSessions.length - 1, current + 1);
        cardRefs.current[next]?.focus();
      } else {
        e.preventDefault();
        const next = current === -1 ? 0 : Math.max(0, current - 1);
        cardRefs.current[next]?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSessions.length, editSession]);

  const deleteSession = (id: string, displayName: string) => {
    setConfirmDialog({
      message: `Delete realm "${displayName}"?`,
      onConfirm: async () => {
        await apiFetch(`/session/${id}`, { method: 'DELETE' });
        loadSessions();
        loadLimits();
        setConfirmDialog(null);
      }
    });
  };

  return (
    <div className="h-[100dvh] bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          confirmLabel="Delete"
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {editSession && (
        <EditSessionModal
          sessionName={editSession.displayName}
          sessionId={editSession.id}
          initialDifficulty={editSession.difficulty}
          initialGameMode={editSession.gameMode}
          initialDmPrep={editSession.dmPrep}
          initialWorldDescription={editSession.worldDescription}
          onSave={(difficulty, gameMode, dmPrep, worldDescription) => {
            setActiveSessions(prev => prev.map(s =>
              s.id === editSession.id ? { ...s, difficulty, gameMode, dmPrep: dmPrep || undefined, worldDescription: worldDescription || undefined } : s
            ));
            setEditSession(null);
            loadSessions();
          }}
          onCancel={() => setEditSession(null)}
        />
      )}

      <SiteHeader />

      {/* Single scrollable content area - no nested scroll boxes */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="flex flex-col gap-4 px-4 md:px-8 pt-4 pb-6 relative z-[10] w-full max-w-6xl mx-auto min-h-full">
          {/* New world / limit button */}
          {sessionLimit && sessionLimit.current >= sessionLimit.max ? (
            <div className="px-8 py-5 bg-slate-800 border-2 border-slate-700 rounded-[32px] text-center">
              <p className="text-slate-400 font-black uppercase italic tracking-tighter text-xl md:text-2xl">REALM LIMIT REACHED</p>
              <p className="text-slate-500 text-sm mt-1">{sessionLimit.current} / {sessionLimit.max} realms - delete one to start another</p>
            </div>
          ) : (
            <button
              onClick={() => navigate('/create-session')}
              className="px-6 py-3 md:py-6 bg-amber-600 hover:bg-amber-500 rounded-[32px] text-lg md:text-4xl font-black shadow-[0_8px_0_rgb(146,64,14)] md:shadow-[0_12px_0_rgb(146,64,14)] transition-all uppercase italic tracking-tighter w-full flex items-center justify-center gap-3"
            >
              <img
                src={imgSrc('/images/icon_dice.png')}
                className="w-8 h-8 md:w-14 md:h-14 rounded-full object-cover animate-dice-shake flex-shrink-0"
                alt=""
              />
              START A NEW REALM{sessionLimit ? ` (${sessionLimit.current}/${sessionLimit.max})` : ''}
            </button>
          )}

          {/* Sessions list */}
          {activeSessions.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xl md:text-4xl font-black uppercase tracking-tighter text-white italic">Active Realms 🌍</h3>
              {activeSessions.map((sess, i) => (
                <WorldCard
                  key={sess.id}
                  enterRef={el => {
                    cardRefs.current[i] = el;
                  }}
                  session={sess}
                  onEnter={() => navigate(getSessionEntryPath(sess))}
                  onDelete={() => deleteSession(sess.id, sess.displayName)}
                  onEdit={() => setEditSession({ id: sess.id, displayName: sess.displayName, difficulty: sess.difficulty, gameMode: sess.gameMode, dmPrep: sess.dmPrep, worldDescription: sess.worldDescription })}
                  onAssemble={() => navigate(`/session/${sess.id}/assembly`)}
                />
              ))}
            </div>
          )}

          {/* Spacer pushes bottom buttons down on tall screens */}
          <div className="flex-1" />

          <div className="flex gap-4">
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
      </div>

      <DmFooter />
    </div>
  );
};
