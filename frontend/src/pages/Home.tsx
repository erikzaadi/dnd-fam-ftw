import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
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
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-8">
      {confirmDialog && (
        <ConfirmDialog 
          message={confirmDialog.message} 
          onConfirm={confirmDialog.onConfirm} 
          onCancel={() => setConfirmDialog(null)} 
        />
      )}
      <div className="max-w-4xl w-full text-center space-y-16 animate-in fade-in zoom-in duration-700">
        <div className="space-y-4">
          <h1 className="text-9xl font-display font-black text-amber-500 drop-shadow-[0_10px_10px_rgba(0,0,0,0.5)] italic tracking-tighter">🐉 AI DM</h1>
        </div>
        
        <div className="flex flex-col gap-12 items-center">
            <button 
                onClick={() => navigate('/create-session')} 
                className="px-16 py-8 bg-amber-600 hover:bg-amber-500 rounded-[32px] text-4xl font-black shadow-[0_12px_0_rgb(146,64,14)] transition-all uppercase italic tracking-tighter"
            >
                START A NEW WORLD
            </button>

            {activeSessions.length > 0 && (
                <div className="w-full bg-slate-900 p-12 rounded-[60px] border-2 border-slate-800 shadow-2xl flex flex-col space-y-8">
                    <h3 className="text-4xl font-black uppercase tracking-tighter text-white italic">Active Worlds</h3>
                    <div className="flex-grow overflow-y-auto space-y-4 max-h-[400px]">
                    {activeSessions.map(sess => (
                        <div key={sess.id} className="w-full p-6 bg-black/40 hover:bg-amber-500/10 rounded-[32px] border-2 border-slate-800 text-amber-500 cursor-pointer flex justify-between items-center" onClick={() => navigate(`/session/${sess.id}/recap`)}>
                        <span>{sess.displayName}</span>
                        <button onClick={(e) => { e.stopPropagation(); deleteSession(sess.id); }} className="text-rose-500/20 hover:text-rose-500">✕</button>
                        </div>
                    ))}
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
