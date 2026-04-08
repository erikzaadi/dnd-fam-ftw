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
import { TurnHistoryCard } from '../components/game/TurnHistoryCard';

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
  const [actionError, setActionError] = useState<string | null>(null);

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
    if (id) { joinSession(id); }
  }, [id, joinSession]);

  useEffect(() => {
    if (!id) return;
    let es: EventSource;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      es = new EventSource(`/api/session/${id}/events`);

      es.onmessage = (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        if (data.type === 'dm_narrating') {
          setLoading(true);
        } else if (data.type === 'turn_complete') {
          setLoading(false);
          setCustomAction('');
          joinSession(id);
        } else if (data.type === 'party_update') {
          joinSession(id);
        }
      };

      es.onerror = () => {
        es.close();
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => { es?.close(); clearTimeout(reconnectTimer); };
  }, [id, joinSession]);

  const submitAction = async (label: string, stat: string, diff: string) => {
    if (!session) {return;}
    const actingCharacterId = session.activeCharacterId;
    setLoading(true);
    setActionError(null);
    const res = await fetch(`/api/session/${session.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: label, statUsed: stat, difficulty: diff, characterId: actingCharacterId })
    });
    if (res.status === 429) {
      const data = await res.json();
      setLoading(false);
      setActionError(data.message ?? 'The AI is busy, please try again.');
      return;
    }
    // loading cleared + session refreshed via SSE turn_complete
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
      const startAdventure = async () => {
        setLoading(true);
        await fetch(`/api/session/${id}/start`, { method: 'POST' });
        await joinSession(id!);
        setLoading(false);
      };
      return (
        <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-8 gap-8">
            <h1 className="text-4xl font-black text-amber-500">Ready to start?</h1>
            <button onClick={startAdventure} disabled={loading} className="px-12 py-6 bg-amber-600 hover:bg-amber-500 rounded-2xl text-2xl font-black italic disabled:opacity-50 transition-all">
              {loading ? 'Summoning the DM...' : 'Begin Adventure'}
            </button>
            <button onClick={() => navigate(`/session/${id}/assembly`)} disabled={loading} className="px-12 py-6 bg-slate-700 rounded-2xl text-2xl font-black disabled:opacity-30">Finalize Your Party</button>
            <Link to="/" className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 uppercase font-black text-xs tracking-widest transition-all">Exit World</Link>
        </div>
      );
  }

  const isCurrentTurn = viewedTurnIdx === history.length - 1;
  const displayTurn = history[viewedTurnIdx] ?? null;
  const nextTurn = !isCurrentTurn ? history[viewedTurnIdx + 1] ?? null : null;
  const takenAction = nextTurn?.lastAction ?? null;
  const takenChar = nextTurn?.characterId ? session.party.find(c => c.id === nextTurn.characterId) ?? null : null;
  const activeChar = session.party.find(c => c.id === session.activeCharacterId) || null;

  return (
    <div className="min-h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-slate-100 p-8">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-slate-800/60">
            <div className="flex items-center gap-6">
                <h1 className="text-amber-500 text-3xl font-display font-black italic tracking-tight">{session.displayName}</h1>
                <PartyBox party={session.party} activeCharacterId={session.activeCharacterId} onCharacterClick={setSelectedCharacter} />
            </div>
            <Link to="/" className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 uppercase font-black text-xs tracking-widest transition-all">Exit World</Link>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
            <div className="space-y-6">
                <Narration history={history} party={session.party} loading={loading} onTurnClick={setViewedTurnIdx} viewedTurnIdx={viewedTurnIdx} />
                {actionError && (
                  <div className="flex items-center justify-between gap-4 px-6 py-3 bg-rose-950/60 border border-rose-700 rounded-2xl text-rose-300 text-sm">
                    <span>{actionError}</span>
                    <button onClick={() => setActionError(null)} className="text-rose-500 hover:text-rose-200 font-black">✕</button>
                  </div>
                )}
                {isCurrentTurn
                  ? (!loading && <ActionControls turn={displayTurn} loading={loading} onSubmit={submitAction} customAction={customAction} setCustomAction={setCustomAction} activeCharacter={activeChar} />)
                  : <TurnHistoryCard choices={displayTurn?.choices ?? []} takenAction={takenAction} character={takenChar} />
                }
            </div>
            
            <div className="space-y-6">
                <div className="bg-slate-900 rounded-[50px] border border-slate-800 overflow-hidden h-[600px]">
                    {displayTurn?.imageUrl ? (
                        <img src={displayTurn.imageUrl} className="w-full h-full object-cover cursor-pointer" onClick={() => setFullscreenImage(displayTurn.imageUrl!)} />
                    ) : <div className="flex items-center justify-center h-full text-slate-600">Scene image...</div>}
                </div>
                <Inventory party={session.party} />
            </div>
        </div>

        {fullscreenImage && <FullscreenImage url={fullscreenImage} onClose={() => setFullscreenImage(null)} />}
        {confirmDialog && <ConfirmDialog message={confirmDialog.message} onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} onCancel={() => setConfirmDialog(null)} />}
        {selectedCharacter && <CharacterPopup character={selectedCharacter} onClose={() => setSelectedCharacter(null)} onAvatarClick={(url) => { setSelectedCharacter(null); setFullscreenImage(url); }} />}
    </div>
  );
};