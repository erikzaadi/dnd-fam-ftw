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
  const [lastRoll, setLastRoll] = useState<{ roll: number; success: boolean; stat: string; statBonus?: number; itemBonus?: number; isCritical?: boolean } | null>(null);
  const [dieExiting, setDieExiting] = useState(false);
  const [interventionBanner, setInterventionBanner] = useState<string | null>(null);
  const [sanctuaryBanner, setSanctuaryBanner] = useState<string | null>(null);

  // Full reload - only used on initial mount and for party_update
  const joinSession = useCallback(async (sessionId: string) => {
    const res = await fetch(api(`/session/${sessionId}`));
    if (!res.ok) { navigate('/'); return; }
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
  }, [navigate]);

  useEffect(() => {
    if (id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      joinSession(id);
    }
  }, [id, joinSession]);

  useEffect(() => {
    if (!lastRoll) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setLastRoll(null); setDieExiting(false); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lastRoll]);

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
          setCustomAction('');
          if (data.session) setSession(data.session);
          if (data.turnResult) {
            setHistory(prev => {
              const updated = [...prev, data.turnResult];
              setViewedTurnIdx(updated.length - 1);
              return updated;
            });
            if (!data.session?.savingsMode) setImageLoading(true);
          }
          const roll = data.turnResult?.lastAction?.actionResult;
          if (roll && roll.statUsed !== 'none') {
            setLastRoll({ roll: roll.roll, success: roll.success, stat: roll.statUsed, statBonus: roll.statBonus, itemBonus: roll.itemBonus, isCritical: roll.isCritical });
            setDieExiting(false);
            setTimeout(() => setDieExiting(true), 3000);
            setTimeout(() => { setLastRoll(null); setDieExiting(false); }, 3500);
          }
        } else if (data.type === 'image_ready') {
          setImageLoading(false);
          setHistory(prev => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            // Don't overwrite static images on intervention/sanctuary turns
            if (last.turnType === 'intervention' || last.turnType === 'sanctuary') return prev;
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, imageUrl: data.imageUrl };
            return updated;
          });
        } else if (data.type === 'intervention') {
          setInterventionBanner(data.turnResult?.narration ?? 'A mysterious force saved the party!');
          if (data.session) setSession(data.session);
          if (data.turnResult) setHistory(prev => { const u = [...prev, data.turnResult]; setViewedTurnIdx(u.length - 1); return u; });
          setTimeout(() => setInterventionBanner(null), 8000);
        } else if (data.type === 'sanctuary_recovery') {
          setSanctuaryBanner(data.turnResult?.narration ?? 'The party found sanctuary...');
          if (data.session) setSession(data.session);
          if (data.turnResult) setHistory(prev => { const u = [...prev, data.turnResult]; setViewedTurnIdx(u.length - 1); return u; });
          setTimeout(() => setSanctuaryBanner(null), 10000);
        } else if (data.type === 'party_update') {
          // party_update doesn't carry full history - only refresh session
          if (data.session) setSession(data.session);
          else joinSession(id);
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

  const submitItemAction = async (actionType: 'use_item' | 'give_item', ownerCharId: string, itemId: string, targetCharId: string) => {
    if (!session) return;
    setLoading(true);
    setActionError(null);
    const res = await fetch(api(`/session/${session.id}/action`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionType, characterId: ownerCharId, itemId, targetCharacterId: targetCharId })
    });
    if (!res.ok) {
      const data = await res.json();
      setLoading(false);
      setActionError(data.message ?? data.error ?? 'Item action failed.');
    }
    // loading cleared + session refreshed via SSE turn_complete
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
    <div className="min-h-screen lg:h-screen flex flex-col lg:overflow-hidden bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-slate-100">
      <header className="flex-shrink-0 flex flex-wrap justify-between items-center gap-y-3 px-4 md:px-8 pt-4 md:pt-6 pb-4 md:pb-5 border-b border-slate-800/60">
        <div className="flex items-center gap-3 md:gap-6 flex-wrap">
          <h1 className="text-amber-500 text-xl md:text-3xl font-display font-black italic tracking-tight">{session.displayName}</h1>
          <PartyBox party={session.party} activeCharacterId={session.activeCharacterId} onCharacterClick={setSelectedCharacter} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleUseLocalAI}
            title={session.useLocalAI ? 'Using LocalAI - click to switch to OpenAI' : 'Using OpenAI - click to switch to LocalAI'}
            className={`px-3 py-2 rounded-xl border font-black text-xs tracking-widest uppercase transition-all cursor-pointer ${session.useLocalAI ? 'border-purple-500 text-purple-400 bg-purple-500/10' : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-400'}`}
          >
            {session.useLocalAI ? '🏠 Local' : '☁️ Cloud'}
          </button>
          <button
            onClick={toggleSavingsMode}
            title={session.savingsMode ? 'Savings mode on - no scene images' : 'Savings mode off - generating scene images'}
            className={`px-3 py-2 rounded-xl border font-black text-xs tracking-widest uppercase transition-all cursor-pointer ${session.savingsMode ? 'border-amber-500 text-amber-400 bg-amber-500/10' : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-400'}`}
          >
            {session.savingsMode ? '🪙 Saving' : '🖼 Images'}
          </button>
          <Link to="/" className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 uppercase font-black text-xs tracking-widest transition-all">Exit World</Link>
        </div>
      </header>

      {/* Middle: story + scene - fills remaining space, only story scrolls */}
      <div className={`lg:flex-1 lg:min-h-0 grid gap-4 md:gap-6 px-4 md:px-8 py-4 md:py-5 ${!session.savingsMode ? 'lg:grid-cols-2' : ''}`}>
        <div className="min-h-0">
          <Narration history={history} party={session.party} loading={loading} onTurnClick={setViewedTurnIdx} viewedTurnIdx={viewedTurnIdx} />
        </div>
        {!session.savingsMode && (
          <div className="bg-slate-900 rounded-[50px] border border-slate-800 overflow-hidden min-h-0">
            {displayTurn?.imageUrl ? (
              <img src={imgSrc(displayTurn.imageUrl)} className="w-full h-full object-cover cursor-pointer animate-ken-burns" onClick={() => setFullscreenImage(imgSrc(displayTurn.imageUrl))} />
            ) : (isCurrentTurn && imageLoading) ? (
              <div className="flex flex-col items-center justify-center gap-3 text-slate-500 h-full">
                <div className="w-10 h-10 border-4 border-slate-700 border-t-amber-500 rounded-full animate-spin" />
                <span className="text-sm font-medium tracking-wide">Painting the scene...</span>
              </div>
            ) : <img src={imgSrc('/api/images/default_scene.png')} className="w-full h-full object-cover opacity-40" />}
          </div>
        )}
      </div>

      {/* Bottom: always visible */}
      <div className="flex-shrink-0 px-4 md:px-8 pb-4 md:pb-6 space-y-3">
        {actionError && (
          <div className="flex items-center justify-between gap-4 px-6 py-3 bg-rose-950/60 border border-rose-700 rounded-2xl text-rose-300 text-sm">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="text-rose-500 hover:text-rose-200 font-black">✕</button>
          </div>
        )}
        {isCurrentTurn
          ? loading
            ? (
              <div className="relative h-[120px] rounded-[40px] border border-slate-800 overflow-hidden">
                <img src={imgSrc('/api/images/dm_thinking.png')} className="absolute inset-0 w-full h-full object-cover opacity-30" />
                <div className="absolute inset-0 flex items-center justify-center gap-3">
                  <div className="w-5 h-5 border-2 border-slate-600 border-t-amber-500 rounded-full animate-spin" />
                  <span className="text-sm font-black uppercase tracking-widest text-amber-500/80 animate-pulse">The DM is weaving fate...</span>
                </div>
              </div>
            )
            : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeChar?.status === 'downed'
                  ? (
                    <div className="flex flex-col items-center gap-3 p-6 bg-slate-900/50 rounded-[40px] border border-slate-800 text-center">
                      <div className="flex items-center gap-3">
                        <img src={imgSrc(activeChar.avatarUrl)} className="w-12 h-12 rounded-full object-cover grayscale opacity-50 border-2 border-slate-700" />
                        <div>
                          <div className="font-black text-sm uppercase tracking-widest text-slate-400">{activeChar.name} is downed</div>
                          <div className="text-[10px] text-slate-600 uppercase tracking-widest">0/{activeChar.max_hp} HP</div>
                        </div>
                      </div>
                      <p className="text-slate-500 text-sm">
                        {session.party.every(c => c.status === 'downed')
                          ? 'The whole party is down... the adventure hangs by a thread.'
                          : 'Another party member needs to use a healing item to revive them.'}
                      </p>
                    </div>
                  )
                  : <ActionControls turn={displayTurn} loading={loading} onSubmit={submitAction} customAction={customAction} setCustomAction={setCustomAction} activeCharacter={activeChar} sessionId={id!} />
                }
                <Inventory party={session.party} activeCharacterId={session.activeCharacterId} onUseItem={(o,i,t) => submitItemAction('use_item',o,i,t)} onGiveItem={(o,i,t) => submitItemAction('give_item',o,i,t)} disabled={loading} />
              </div>
            )
          : <TurnHistoryCard choices={displayTurn?.choices ?? []} takenAction={takenAction} character={takenChar} turnType={displayTurn?.turnType} narration={displayTurn?.narration} />
        }
      </div>

      {sanctuaryBanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/70 animate-in fade-in duration-700" onClick={() => setSanctuaryBanner(null)}>
          <div className="flex flex-col items-center gap-6 p-10 rounded-3xl border-2 border-slate-500 bg-slate-900/95 shadow-2xl max-w-lg mx-4 animate-in zoom-in-75 duration-500">
            <div className="text-6xl">🏕️</div>
            <div className="text-2xl font-black uppercase tracking-tight text-slate-300 text-center">Sanctuary</div>
            <p className="text-slate-400 text-center leading-relaxed">{sanctuaryBanner}</p>
            <span className="text-xs text-slate-600 uppercase tracking-widest">tap to continue</span>
          </div>
        </div>
      )}

      {interventionBanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/60 animate-in fade-in duration-500" onClick={() => setInterventionBanner(null)}>
          <div className="flex flex-col items-center gap-6 p-10 rounded-3xl border-2 border-amber-500 bg-amber-950/90 shadow-2xl max-w-lg mx-4 animate-in zoom-in-75 duration-500">
            <div className="text-6xl">🐉</div>
            <div className="text-2xl font-black uppercase tracking-tight text-amber-400 text-center">Miraculous Rescue!</div>
            <p className="text-amber-100 text-center leading-relaxed">{interventionBanner}</p>
            <span className="text-xs text-amber-600 uppercase tracking-widest">tap to continue</span>
          </div>
        </div>
      )}

      {lastRoll && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/40 animate-in fade-in duration-400 transition-opacity duration-500 cursor-pointer ${dieExiting ? 'opacity-0' : 'opacity-100'}`}
          onClick={() => { setLastRoll(null); setDieExiting(false); }}
        >
          <div className={`flex flex-col items-center gap-4 p-10 rounded-3xl border-2 shadow-2xl animate-in zoom-in-75 duration-500 ease-out ${lastRoll.isCritical ? 'bg-amber-950/95 border-amber-400 shadow-amber-500/30' : lastRoll.success ? 'bg-emerald-950/90 border-emerald-500' : 'bg-rose-950/90 border-rose-500'}`}>
            {lastRoll.isCritical && <div className="text-4xl animate-bounce">🎉</div>}
            <D20 roll={lastRoll.roll} success={lastRoll.success} size={180} />
            <div className="flex flex-col items-center gap-2">
              {lastRoll.isCritical
                ? <span className="text-2xl font-black uppercase tracking-widest text-amber-300">NATURAL 20!</span>
                : <span className={`text-2xl font-black uppercase tracking-widest ${lastRoll.success ? 'text-emerald-300' : 'text-rose-300'}`}>{lastRoll.success ? 'Success!' : 'Failed!'}</span>
              }
              <div className="flex items-center gap-2 text-sm font-black text-slate-400">
                <span className="text-slate-200">{lastRoll.roll}</span>
                {lastRoll.statBonus != null && lastRoll.statBonus > 0 && <><span>+</span><span className="text-blue-400">{lastRoll.statBonus} {lastRoll.stat}</span></>}
                {lastRoll.itemBonus != null && lastRoll.itemBonus > 0 && <><span>+</span><span className="text-amber-400">{lastRoll.itemBonus} items</span></>}
              </div>
              <span className="text-[10px] uppercase tracking-widest text-slate-600">tap to dismiss</span>
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