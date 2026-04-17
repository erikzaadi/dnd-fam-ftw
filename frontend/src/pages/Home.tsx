import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DmFooter } from '../components/DmFooter';
import { SiteHeader } from '../components/SiteHeader';
import { api } from '../lib/api';

export const Home = () => {
  const [activeSessions, setActiveSessions] = useState<{ id: string; displayName: string }[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<{message: string, onConfirm: () => void} | null>(null);
  const navigate = useNavigate();

  const loadSessions = () => {
    fetch(api('/sessions'))
      .then(res => res.json())
      .then(data => setActiveSessions(data));
  };

  useEffect(loadSessions, []);

  const deleteSession = (id: string) => {
    setConfirmDialog({
      message: `Permanently destroy this world (${id})?`,
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

      {/* Content section - flex column, buttons pinned top and bottom */}
      <div className="flex-1 flex flex-col gap-4 px-4 md:px-6 pt-4 pb-6 relative z-[10] min-h-0 max-w-3xl w-full mx-auto">
        <button
          onClick={() => navigate('/create-session')}
          className="px-8 py-5 md:px-16 md:py-6 bg-amber-600 hover:bg-amber-500 rounded-[32px] text-2xl md:text-4xl font-black shadow-[0_12px_0_rgb(146,64,14)] transition-all uppercase italic tracking-tighter w-full flex-shrink-0"
        >
          START A NEW WORLD
        </button>

        {activeSessions.length > 0 ? (
          <div className="flex-1 bg-slate-900 p-4 rounded-[32px] border-2 border-slate-800 shadow-2xl flex flex-col gap-2 min-h-0">
            <h3 className="text-lg font-black uppercase tracking-tighter text-white italic px-2 flex-shrink-0">Active Worlds</h3>
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
              {activeSessions.map(sess => (
                <div key={sess.id} className="w-full p-3 bg-black/40 hover:bg-amber-500/10 rounded-[20px] border-2 border-slate-800 text-amber-500 cursor-pointer flex justify-between items-center" onClick={() => navigate(`/session/${sess.id}/recap`)}>
                  <span>{sess.displayName}</span>
                  <button onClick={(e) => { e.stopPropagation(); deleteSession(sess.id); }} className="text-rose-500/20 hover:text-rose-500">✕</button>
                </div>
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
