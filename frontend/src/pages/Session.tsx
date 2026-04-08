import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { Session, Character, TurnResult } from '../types';
import { PartyBox } from '../components/PartyBox';
import { CharacterPopup } from '../components/CharacterPopup';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FullscreenImage } from '../components/FullscreenImage';
import { Narration } from '../components/game/Narration';
import { Inventory } from '../components/game/Inventory';
import { ActionControls } from '../components/game/ActionControls';

export const SessionPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<TurnResult[]>([]);
  const [viewedTurnIdx, setViewedTurnIdx] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [customAction, setCustomAction] = useState("");
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{message: string, onConfirm: () => void} | null>(null);

  const joinSession = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/session/${sessionId}`);
    if (res.ok) {
      const data = await res.json();
      setSession(data);
      const hRes = await fetch(`/api/session/${data.id}/history`);
      const hData = await hRes.json();
      setHistory(hData);
      setViewedTurnIdx(hData.length - 1);
    } else {
      navigate('/');
    }
  }, [navigate]);

  useEffect(() => {
    const run = async () => {
        if (id) {await joinSession(id);}
    };
    run();
  }, [id, joinSession]);

  const submitAction = async (label: string, stat: string, diff: string) => {
    if (!session) {return;}
    setLoading(true);
    await fetch(`/api/session/${session.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: label, statUsed: stat, difficulty: diff })
    });
    setLoading(false);
    setCustomAction("");
    joinSession(session.id);
  };

  if (!session) {return <div className="text-white">Loading...</div>;}

  if (session.party.length === 0) {
      return (
        <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-8 gap-8">
            <h1 className="text-4xl font-black text-amber-500">Your party is empty</h1>
            <button onClick={() => navigate(`/session/${id}/assembly`)} className="px-12 py-6 bg-amber-600 rounded-2xl text-2xl font-black italic">Finalize Your Party</button>
        </div>
      );
  }

  if (history.length === 0) {
      return (
        <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-8 gap-8">
            <h1 className="text-4xl font-black text-amber-500">Ready to start?</h1>
            <button onClick={() => fetch(`/api/session/${id}/start`, {method: 'POST'}).then(() => joinSession(id!))} className="px-12 py-6 bg-amber-600 rounded-2xl text-2xl font-black italic">Begin Adventure</button>
            <button onClick={() => navigate(`/session/${id}/assembly`)} className="px-12 py-6 bg-slate-700 rounded-2xl text-2xl font-black">Finalize Your Party</button>
        </div>
      );
  }

  const lastTurn = history[viewedTurnIdx];
  const activeChar = session.party.find(c => c.id === session.activeCharacterId) || null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
        <header className="flex justify-between items-center mb-8">
            <div className="flex items-center gap-6">
                <h1 className="text-amber-500 text-3xl font-black">{session.displayName}</h1>
                <PartyBox party={session.party} activeCharacterId={session.activeCharacterId} onCharacterClick={setSelectedCharacter} />
            </div>
            <Link to="/" className="text-slate-500 hover:text-white uppercase font-black text-xs">Exit World</Link>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
            <div className="space-y-6">
                <Narration history={history} loading={loading} onTurnClick={setViewedTurnIdx} viewedTurnIdx={viewedTurnIdx} />
                <ActionControls lastTurn={lastTurn} loading={loading} onSubmit={submitAction} customAction={customAction} setCustomAction={setCustomAction} activeCharacter={activeChar} disabled={viewedTurnIdx !== history.length - 1} />
            </div>
            
            <div className="space-y-6">
                <div className="bg-slate-900 rounded-[50px] border border-slate-800 overflow-hidden h-[600px]">
                    {lastTurn?.imageUrl ? (
                        <img src={lastTurn.imageUrl} className="w-full h-full object-cover cursor-pointer" onClick={() => setFullscreenImage(lastTurn.imageUrl!)} />
                    ) : <div className="flex items-center justify-center h-full text-slate-600">Scene image...</div>}
                </div>
                <Inventory character={activeChar} />
            </div>
        </div>

        {fullscreenImage && <FullscreenImage url={fullscreenImage} onClose={() => setFullscreenImage(null)} />}
        {confirmDialog && <ConfirmDialog message={confirmDialog.message} onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} onCancel={() => setConfirmDialog(null)} />}
        {selectedCharacter && <CharacterPopup character={selectedCharacter} onClose={() => setSelectedCharacter(null)} onAvatarClick={(url) => { setSelectedCharacter(null); setFullscreenImage(url); }} />}
    </div>
  );
};