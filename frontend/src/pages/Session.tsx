import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { Session, Character, TurnResult } from '../types';
import { apiFetch, apiUrl, imgSrc } from '../lib/api';
import { PartyBox } from '../components/PartyBox';
import { CharacterPopup } from '../components/CharacterPopup';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FullscreenImage } from '../components/FullscreenImage';
import { Narration } from '../components/game/Narration';
import { ActionControls } from '../components/game/ActionControls';
import { RollBreakdown } from '../components/game/RollBreakdown';
import { D20 } from '../components/game/D20';
import { audioManager } from '../audio/audioManager';
import { useAudioSettings } from '../audio/useAudioSettings';

export const SessionPage = () => {
  const { settings, setMasterMuted } = useAudioSettings();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<TurnResult[]>([]);
  const [viewedTurnIdx, setViewedTurnIdx] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [customAction, setCustomAction] = useState("");
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [fullscreenNarration, setFullscreenNarration] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{message: string, onConfirm: () => void} | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [lastRoll, setLastRoll] = useState<{ roll: number; success: boolean; stat: string; statBonus?: number; itemBonus?: number; isCritical?: boolean; difficultyTarget?: number; rollNarration?: string } | null>(null);
  const [dieExiting, setDieExiting] = useState(false);
  const [interventionBanner, setInterventionBanner] = useState<string | null>(null);
  const [sanctuaryBanner, setSanctuaryBanner] = useState<string | null>(null);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);

  const joinSession = useCallback(async (sessionId: string) => {
    const res = await apiFetch(`/session/${sessionId}`);
    if (!res.ok) {
      navigate('/'); return;
    }
    const data = await res.json();
    setSession(data);
    const hRes = await apiFetch(`/session/${data.id}/history`);
    const hData = await hRes.json();
    setHistory(hData);
    setViewedTurnIdx(hData.length - 1);
    apiFetch('/namespace/limits')
      .then(r => r.json())
      .catch(() => { /* limits unavailable */ });
    const latestTurn = hData[hData.length - 1];
    if (latestTurn && !latestTurn.imageUrl && !data.savingsMode) {
      setImageLoading(true);
    }
  }, [navigate]);

  useEffect(() => {
    if (id) {
      joinSession(id);
    }
  }, [id, joinSession]);

  useEffect(() => {
    if (session && history.length > 0) {
      audioManager.startAmbientMusic();
    }
  }, [session, history.length]);

  useEffect(() => {
    if (loading) {
      audioManager.startNarrating();
    } else {
      audioManager.stopNarrating();
    }
  }, [loading]);

  useEffect(() => {
    if (!lastRoll) {
      return;
    }
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLastRoll(null);
        setDieExiting(false);
      }
    };
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
      es = new EventSource(apiUrl(`/session/${id}/events`), { withCredentials: true });

      es.onmessage = (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        if (data.type === 'dm_narrating') {
          setLoading(true);
        } else if (data.type === 'turn_complete') {
          setLoading(false);
          setCustomAction('');
          if (data.session) {
            setSession(data.session);
          }
          if (data.turnResult?.currentTensionLevel) {
            audioManager.setTension(data.turnResult.currentTensionLevel);
          }
          const roll = data.turnResult?.lastAction?.actionResult;
          if (roll && roll.statUsed !== 'none') {
            audioManager.playSfx('dice-roll');
            setTimeout(() => {
              if (roll.roll === 20) {
                audioManager.playSfx('roll-20');
              } else if (roll.success) {
                audioManager.playSfx('success-roll');
              } else {
                audioManager.playSfx('failed-roll');
              }
            }, 600);
            setLastRoll({ 
              roll: roll.roll, 
              success: roll.success, 
              stat: roll.statUsed, 
              statBonus: roll.statBonus, 
              itemBonus: roll.itemBonus, 
              isCritical: roll.isCritical, 
              difficultyTarget: roll.difficultyTarget,
              rollNarration: data.turnResult?.rollNarration
            });
            setDieExiting(false);
            setTimeout(() => setDieExiting(true), 4000);
            setTimeout(() => {
              setLastRoll(null);
              setDieExiting(false);
            }, 4500);
          }
        } else if (data.type === 'image_ready') {
          setImageLoading(false);
          setHistory(prev => {
            if (prev.length === 0) {
              return prev;
            }
            const last = prev[prev.length - 1];
            if (last.turnType === 'intervention' || last.turnType === 'sanctuary') {
              return prev;
            }
            const updated = [...prev];
            updated[updated.length - 1] = { ...last, imageUrl: data.imageUrl };
            return updated;
          });
        } else if (data.type === 'intervention') {
          setInterventionBanner(data.turnResult?.narration ?? 'A mysterious force saved the party!');
          if (data.session) {
            setSession(data.session);
          }
          if (data.turnResult) {
            setHistory(prev => {
              const u = [...prev, data.turnResult];
              setViewedTurnIdx(u.length - 1);
              return u; 
            });
          }
          setTimeout(() => setInterventionBanner(null), 8000);
        } else if (data.type === 'sanctuary_recovery') {
          setSanctuaryBanner(data.turnResult?.narration ?? 'The party found sanctuary...');
          if (data.session) {
            setSession(data.session);
          }
          if (data.turnResult) {
            setHistory(prev => {
              const u = [...prev, data.turnResult];
              setViewedTurnIdx(u.length - 1);
              return u; 
            });
          }
          setTimeout(() => setSanctuaryBanner(null), 10000);
        } else if (data.type === 'party_update') {
          if (data.session) {
            setSession(data.session);
          } else {
            joinSession(id);
          }
        }
      };

      es.onerror = () => {
        es.close();
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      es?.close();
      clearTimeout(reconnectTimer); 
    };
  }, [id, joinSession]);

  const toggleSavingsMode = async () => {
    if (!session) {
      return;
    }
    const enabled = !session.savingsMode;
    await apiFetch(`/session/${session.id}/savings-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    setSession({ ...session, savingsMode: enabled });
  };

  const submitAction = async (action: string, statUsed: string = 'none', difficulty: string = 'normal', difficultyValue: number | null = null, ownerCharId: string | null = null, itemId: string | null = null, targetCharId: string | null = null) => {
    setActionError(null);
    setLoading(true);
    try {
      const res = await apiFetch(`/session/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, statUsed, difficulty, difficultyValue, ownerCharId, itemId, targetCharId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Action failed');
      }
      setSession(data.session);
      setHistory(prev => [...prev, data.turnResult]);
      setViewedTurnIdx(history.length);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setActionError(err.message);
      } else {
        setActionError('An unexpected error occurred');
      }
      setLoading(false);
    }
  };

  if (!session) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-amber-500 animate-pulse font-black uppercase tracking-widest">Loading...</div>;
  }

  return (
    <div className="min-h-screen lg:h-screen flex flex-col lg:overflow-hidden bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-slate-100">
      {headerCollapsed && (
        <div className="fixed top-4 right-4 z-30 flex gap-2">
          <button
            onClick={() => setHeaderCollapsed(false)}
            className="w-10 h-10 flex items-center justify-center bg-slate-900/90 border border-slate-700 rounded-xl text-slate-400 hover:text-white backdrop-blur-sm text-lg"
            title="Show header"
          >☰</button>
          <Link
            to="/"
            onClick={() => audioManager.stopMusic()}
            className="w-10 h-10 flex items-center justify-center bg-slate-900/90 border border-slate-700 rounded-xl text-slate-400 hover:text-white backdrop-blur-sm text-xs font-black"
            title="Exit world"
          >✕</Link>
        </div>
      )}

      {!headerCollapsed && (
        <header className="flex-shrink-0 flex flex-wrap justify-between items-center gap-y-3 px-4 md:px-8 pt-4 md:pt-6 pb-4 md:pb-5 border-b border-slate-800/60">
          <div className="flex items-center gap-3 md:gap-6 flex-wrap">
            <h1 className="text-amber-500 text-xl md:text-3xl font-display font-black italic tracking-tight">{session.displayName}</h1>
            <PartyBox party={session.party} activeCharacterId={session.activeCharacterId} onCharacterClick={setSelectedCharacter} />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSavingsMode}
              title={session.savingsMode ? 'Savings mode on - no scene images' : 'Savings mode off - generating scene images'}
              className={`px-3 py-2 rounded-xl border font-black text-xs tracking-widest uppercase transition-all cursor-pointer ${session.savingsMode ? 'border-amber-500 text-amber-400 bg-amber-500/10' : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-400'}`}
            >
              {session.savingsMode ? '🪙 Saving' : '🖼 Images'}
            </button>
            {settings.musicEnabled && (
              <div className="relative group">
                <button
                  onClick={() => setMasterMuted(!settings.masterMuted)}
                  className={`px-3 py-2 rounded-xl border font-black text-sm transition-all cursor-pointer ${settings.masterMuted ? 'border-amber-500 bg-amber-500/10' : 'border-slate-700 hover:border-slate-500'}`}
                >
                  {settings.masterMuted ? '🔇' : '🔊'}
                </button>
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                  {settings.masterMuted ? 'Unmute' : 'Mute'}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-700" />
                </div>
              </div>
            )}
            {settings.musicEnabled && (
              <div className="relative group">
                <button
                  onClick={() => audioManager.skipTrack()}
                  className="px-3 py-2 rounded-xl border border-slate-700 hover:border-slate-500 font-black text-sm transition-all cursor-pointer"
                >
                  ⏭
                </button>
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                  Skip Track
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-700" />
                </div>
              </div>
            )}
            <Link 
              to="/" 
              onClick={() => {
                audioManager.stopMusic();
              }}
              className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 uppercase font-black text-xs tracking-widest transition-all"
            >Exit World</Link>
            <button onClick={() => setHeaderCollapsed(true)} className="px-2 py-1 rounded-xl border border-slate-700 text-slate-400 hover:text-white text-xs font-black" title="Hide header">▲</button>
          </div>
        </header>
      )}

      <div className={`lg:flex-1 lg:min-h-0 grid gap-4 md:gap-6 px-4 md:px-8 py-4 md:py-5 ${!session.savingsMode ? 'lg:grid-cols-2' : ''}`}>
        <div className="min-h-0">
          <Narration 
            history={history} 
            party={session.party} 
            loading={loading} 
            onTurnClick={(i) => {
              setFullscreenNarration(history[i].narration);
            }} 
            viewedTurnIdx={viewedTurnIdx} 
          />
        </div>
        {!session.savingsMode && (
          <div className="bg-slate-900 rounded-[50px] border border-slate-800 overflow-hidden min-h-0">
            {history[viewedTurnIdx]?.imageUrl ? (
              <img src={imgSrc(history[viewedTurnIdx].imageUrl!)} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-slate-900">
                {imageLoading ? <span className="text-amber-500 animate-pulse font-black uppercase tracking-widest">Generating...</span> : <img src={imgSrc('/images/default_scene.png')} className="w-full h-full object-cover opacity-50" />}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 p-4 md:px-8 md:pb-8">
        <ActionControls 
          turn={history[viewedTurnIdx] ?? null}
          loading={loading}
          activeCharacter={session.party.find(c => c.id === session.activeCharacterId)!} 
          onSubmit={submitAction}
          customAction={customAction}
          setCustomAction={setCustomAction}
          error={actionError} 
          disabled={loading}
          sessionId={session.id}
        />
      </div>

      {/* Popups */}
      {lastRoll && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in" 
          onClick={() => {
            setLastRoll(null);
            setDieExiting(false);
          }}
        >
          <div className={`bg-slate-900 border-2 border-slate-700 p-8 rounded-[40px] shadow-2xl text-center flex flex-col items-center animate-in zoom-in-95 ${dieExiting ? 'animate-out fade-out zoom-out-95' : ''}`}>
            <D20 roll={lastRoll.roll} success={lastRoll.success} size={180} />
            <RollBreakdown
              roll={lastRoll.roll}
              statBonus={lastRoll.statBonus}
              itemBonus={lastRoll.itemBonus}
              stat={lastRoll.stat}
              success={lastRoll.success}
              difficultyTarget={lastRoll.difficultyTarget}
              className="text-sm"
            />
            {lastRoll.rollNarration && (
              <p className="text-amber-100/90 text-center font-medium italic mt-2 max-w-xs leading-tight animate-in slide-in-from-bottom-2 duration-700">
                {lastRoll.rollNarration}
              </p>
            )}
            <span className="text-[10px] uppercase tracking-widest text-slate-600 mt-2">tap to dismiss</span>
          </div>
        </div>
      )}
      {fullscreenImage && <FullscreenImage url={fullscreenImage} onClose={() => setFullscreenImage(null)} />}
      {fullscreenNarration && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950 p-8 md:p-16 animate-in fade-in"
          onClick={() => setFullscreenNarration(null)}
        >
          <div className="max-w-4xl w-full text-center">
            <p className="text-3xl md:text-5xl lg:text-6xl font-serif leading-snug text-slate-100 font-medium italic">
              {fullscreenNarration}
            </p>
            <span className="text-xs uppercase tracking-widest text-slate-600 mt-12 block">tap to dismiss</span>
          </div>
        </div>
      )}
      {interventionBanner && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-amber-950/90 p-8 animate-in fade-in">
          <div className="max-w-xl text-center space-y-4">
            <div className="text-6xl">🐉</div>
            <p className="text-amber-100 text-center text-2xl font-display font-black italic leading-snug">{interventionBanner}</p>
          </div>
        </div>
      )}
      {sanctuaryBanner && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/90 p-8 animate-in fade-in">
          <div className="max-w-xl text-center space-y-4">
            <div className="text-6xl">✨</div>
            <p className="text-slate-200 text-center text-2xl font-display font-black italic leading-snug">{sanctuaryBanner}</p>
            <span className="text-xs text-slate-600 uppercase tracking-widest">tap to continue</span>
          </div>
        </div>
      )}
      {confirmDialog && <ConfirmDialog message={confirmDialog.message} onConfirm={() => {
        confirmDialog.onConfirm();
        setConfirmDialog(null); 
      }} onCancel={() => setConfirmDialog(null)} />}
      {selectedCharacter && <CharacterPopup character={selectedCharacter} onClose={() => setSelectedCharacter(null)} onAvatarClick={(url) => {
        setSelectedCharacter(null);
        setFullscreenImage(url); 
      }} />}
    </div>
  );
};
