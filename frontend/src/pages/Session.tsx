import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { Session, Character, TurnResult } from '../types';
import { api, imgSrc } from '../lib/api';
import { PartyBox } from '../components/PartyBox';
import { CharacterPopup } from '../components/CharacterPopup';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FullscreenImage } from '../components/FullscreenImage';
import { Narration } from '../components/game/Narration';
import { Inventory } from '../components/game/Inventory';
import { ActionControls } from '../components/game/ActionControls';
import { TurnHistoryCard } from '../components/game/TurnHistoryCard';
import { D20 } from '../components/game/D20';

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
  const [imageLoading, setImageLoading] = useState(false);
  const [lastRoll, setLastRoll] = useState<{ roll: number; success: boolean; stat: string } | null>(null);

  const joinSession = useCallback(async (sessionId: string) => {
    const res = await fetch(api(`/session/${sessionId}`));
    if (res.ok) {
      const data = await res.json();
      setSession(data);
      const hRes = await fetch(api(`/session/${data.id}/history`));
      const hData = await hRes.json();
      setHistory(hData);
      setViewedTurnIdx(hData.length - 1);
      const latestTurn = hData[hData.length - 1];
      if (latestTurn && !latestTurn.imageUrl && !data.savingsMode) {
        setImageLoading(true);
      }
    } else {
      navigate('/');
    }
  }, [navigate]);

  useEffect(() => {
    if (id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      joinSession(id);
    }
  }, [id, joinSession]);

  useEffect(() => {
    if (!id) {
      return;
    }
    let es: EventSource;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      es = new EventSource(api(`/session/${id}/events`));

      es.onmessage = (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        if (data.type === 'dm_narrating') {
          setLoading(true);
        } else if (data.type === 'turn_complete') {
          setLoading(false);
          setImageLoading(!data.session?.savingsMode);
          setCustomAction('');
          const roll = data.turnResult?.lastAction?.actionResult;
          if (roll && roll.statUsed !== 'none') {
            setLastRoll({ roll: roll.roll, success: roll.success, stat: roll.statUsed });
            setTimeout(() => setLastRoll(null), 4000);
          }
          joinSession(id);
        } else if (data.type === 'image_ready') {
          setImageLoading(false);
          setHistory(prev => {
            if (prev.length === 0) {
              return prev;
            }
            const updated = [...prev];
            updated[updated.length - 1] = { ...updated[updated.length - 1], imageUrl: data.imageUrl };
            return updated;
          });
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
    return () => {
      es?.close(); clearTimeout(reconnectTimer); 
    };
  }, [id, joinSession]);

  const toggleSavingsMode = async () => {
    if (!session) {
      return;
    }
    const enabled = !session.savingsMode;
    await fetch(api(`/session/${session.id}/savings-mode`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    setSession({ ...session, savingsMode: enabled });
  };

  const toggleUseLocalAI = async () => {
    if (!session) {
      return;
    }
    const enabled = !session.useLocalAI;
    await fetch(api(`/session/${session.id}/use-local-ai`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    setSession({ ...session, useLocalAI: enabled });
  };

  const submitAction = async (label: string, stat: string, diff: string) => {
    if (!session) {
      return;
    }
    const actingCharacterId = session.activeCharacterId;
    setLoading(true);
    setActionError(null);
    const res = await fetch(api(`/session/${session.id}/action`), {
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

  if (!session) {
    return <div className="text-white">Loading...</div>;
  }

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
      await fetch(api(`/session/${id}/start`), { method: 'POST' });
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
    <div className="min-h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-slate-100 p-4 md:p-8 overflow-x-hidden">
      <header className="flex flex-wrap justify-between items-center gap-y-3 mb-4 md:mb-8 pb-4 md:pb-6 border-b border-slate-800/60">
        <div className="flex items-center gap-3 md:gap-6 flex-wrap">
          <h1 className="text-amber-500 text-xl md:text-3xl font-display font-black italic tracking-tight">{session.displayName}</h1>
          <PartyBox party={session.party} activeCharacterId={session.activeCharacterId} onCharacterClick={setSelectedCharacter} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleUseLocalAI}
            title={session.useLocalAI ? 'Using LocalAI — click to switch to OpenAI' : 'Using OpenAI — click to switch to LocalAI'}
            className={`px-3 py-2 rounded-xl border font-black text-xs tracking-widest uppercase transition-all cursor-pointer ${session.useLocalAI ? 'border-purple-500 text-purple-400 bg-purple-500/10' : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-400'}`}
          >
            {session.useLocalAI ? '🏠 Local' : '☁️ Cloud'}
          </button>
          <button
            onClick={toggleSavingsMode}
            title={session.savingsMode ? 'Savings mode on — no scene images' : 'Savings mode off — generating scene images'}
            className={`px-3 py-2 rounded-xl border font-black text-xs tracking-widest uppercase transition-all cursor-pointer ${session.savingsMode ? 'border-amber-500 text-amber-400 bg-amber-500/10' : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-400'}`}
          >
            {session.savingsMode ? '🪙 Saving' : '🖼 Images'}
          </button>
          <Link to="/" className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 uppercase font-black text-xs tracking-widest transition-all">Exit World</Link>
        </div>
      </header>

      <div className={`grid grid-cols-1 ${!session.savingsMode ? 'lg:grid-cols-2' : ''} gap-4 md:gap-8 mt-4 md:mt-8`}>
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
          {session.savingsMode && <Inventory party={session.party} />}
        </div>

        {!session.savingsMode && (
          <div className="space-y-6">
            <div className="bg-slate-900 rounded-[50px] border border-slate-800 overflow-hidden h-[280px] sm:h-[400px] lg:h-[600px]">
              {displayTurn?.imageUrl ? (
                <img src={imgSrc(displayTurn.imageUrl)} className="w-full h-full object-cover cursor-pointer animate-ken-burns" onClick={() => setFullscreenImage(imgSrc(displayTurn.imageUrl))} />
              ) : (isCurrentTurn && imageLoading) ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
                  <div className="w-10 h-10 border-4 border-slate-700 border-t-amber-500 rounded-full animate-spin" />
                  <span className="text-sm font-medium tracking-wide">Painting the scene...</span>
                </div>
              ) : <img src={imgSrc('/api/images/default_scene.png')} className="w-full h-full object-cover opacity-40" />}
            </div>
            <Inventory party={session.party} />
          </div>
        )}
      </div>

      {lastRoll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/40 animate-in fade-in duration-200">
          <div className={`flex flex-col items-center gap-4 p-10 rounded-3xl border-2 shadow-2xl animate-in zoom-in-75 duration-300 ${lastRoll.success ? 'bg-emerald-950/90 border-emerald-500' : 'bg-rose-950/90 border-rose-500'}`}>
            <D20 roll={lastRoll.roll} success={lastRoll.success} size={180} />
            <div className="flex flex-col items-center gap-1">
              <span className={`text-2xl font-black uppercase tracking-widest ${lastRoll.success ? 'text-emerald-300' : 'text-rose-300'}`}>{lastRoll.success ? 'Success!' : 'Failed!'}</span>
              <span className="text-sm font-black uppercase tracking-widest text-slate-400">{lastRoll.stat}</span>
            </div>
          </div>
        </div>
      )}
      {fullscreenImage && <FullscreenImage url={fullscreenImage} onClose={() => setFullscreenImage(null)} />}
      {confirmDialog && <ConfirmDialog message={confirmDialog.message} onConfirm={() => {
        confirmDialog.onConfirm(); setConfirmDialog(null); 
      }} onCancel={() => setConfirmDialog(null)} />}
      {selectedCharacter && <CharacterPopup character={selectedCharacter} onClose={() => setSelectedCharacter(null)} onAvatarClick={(url) => {
        setSelectedCharacter(null); setFullscreenImage(url); 
      }} />}
    </div>
  );
};