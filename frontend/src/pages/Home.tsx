import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DmFooter } from '../components/DmFooter';
import { SiteHeader } from '../components/SiteHeader';
import { api, imgSrc } from '../lib/api';
import type { SessionPreview } from '../types';

const WorldCard = ({
  session,
  onEnter,
  onDelete,
}: {
  session: SessionPreview;
  onEnter: () => void;
  onDelete: () => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = session.party.length > 0 || session.worldDescription || session.storySummary;

  return (
    <div className="bg-black/40 rounded-[20px] border-2 border-slate-800 overflow-hidden">
      <div className="flex items-center gap-2 p-4">
        <button
          onClick={onEnter}
          className="flex-1 text-left text-amber-400 font-black text-lg tracking-tight hover:text-amber-300 transition-colors truncate"
        >
          {session.displayName}
        </button>
        {hasDetails && (
          <button
            onClick={() => setExpanded(e => !e)}
            className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-black transition-colors ${expanded ? 'bg-amber-600/30 text-amber-400' : 'text-slate-500 hover:text-slate-300 bg-slate-800'}`}
            aria-label="Details"
          >
            ℹ
          </button>
        )}
        <button
          onClick={onDelete}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-600 hover:text-rose-500 hover:bg-rose-500/10 text-sm font-black transition-colors"
          aria-label="Delete"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 px-4 pb-4 pt-3 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          {session.party.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {session.party.map(c => (
                <div key={c.id} className="flex items-center gap-2 bg-slate-800/60 rounded-xl px-2 py-1.5 border border-slate-700/50">
                  {c.avatarUrl && (
                    <img src={imgSrc(c.avatarUrl)} className="w-7 h-7 rounded-lg object-cover flex-shrink-0" alt={c.name} />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-black text-slate-200 leading-tight truncate">{c.name}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide leading-tight">{c.class}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {session.worldDescription && (
            <p className="text-xs text-slate-400 italic leading-relaxed">{session.worldDescription}</p>
          )}
          {session.storySummary && (
            <p className="text-xs text-slate-500 leading-relaxed border-l-2 border-slate-700 pl-2">{session.storySummary}</p>
          )}
        </div>
      )}
    </div>
  );
};

export const Home = () => {
  const [activeSessions, setActiveSessions] = useState<SessionPreview[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<{message: string, onConfirm: () => void} | null>(null);
  const navigate = useNavigate();

  const loadSessions = () => {
    fetch(api('/sessions'))
      .then(res => res.json())
      .then(data => setActiveSessions(data));
  };

  useEffect(loadSessions, []);

  const deleteSession = (id: string, displayName: string) => {
    setConfirmDialog({
      message: `Permanently destroy "${displayName}"?`,
      onConfirm: async () => {
        await fetch(api(`/session/${id}`), { method: 'DELETE' });
        loadSessions();
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

      <SiteHeader />

      <div className="flex-1 flex flex-col gap-4 px-4 md:px-6 pt-4 pb-6 relative z-[10] min-h-0 max-w-3xl w-full mx-auto">
        <button
          onClick={() => navigate('/create-session')}
          className="px-8 py-5 md:px-16 md:py-6 bg-amber-600 hover:bg-amber-500 rounded-[32px] text-2xl md:text-4xl font-black shadow-[0_12px_0_rgb(146,64,14)] transition-all uppercase italic tracking-tighter w-full flex-shrink-0"
        >
          START A NEW WORLD
        </button>

        {activeSessions.length > 0 ? (
          <div className="flex-1 bg-slate-900 p-4 rounded-[32px] border-2 border-slate-800 shadow-2xl flex flex-col gap-3 min-h-0">
            <h3 className="text-xl font-black uppercase tracking-tighter text-white italic px-2 flex-shrink-0">Active Worlds</h3>
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
              {activeSessions.map(sess => (
                <WorldCard
                  key={sess.id}
                  session={sess}
                  onEnter={() => navigate(`/session/${sess.id}/recap`)}
                  onDelete={() => deleteSession(sess.id, sess.displayName)}
                />
              ))}
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
