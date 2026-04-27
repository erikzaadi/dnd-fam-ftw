import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session, Character, TurnResult, HpChange, InventoryChange } from '../types';
import { apiFetch, imgSrc } from '../lib/api';
import { useSessionEvents } from '../hooks/useSessionEvents';
import { PageLoader } from '../components/PageLoader';
import { CharacterPopup } from '../components/CharacterPopup';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FullscreenImage } from '../components/FullscreenImage';
import { Inventory } from '../components/game/Inventory';
import { RollBreakdown } from '../components/game/RollBreakdown';
import { D20 } from '../components/game/D20';
import { SessionHud, GearPopover } from '../components/game/SessionHud';
import { StoryStage } from '../components/game/StoryStage';
import { ActionDock } from '../components/game/ActionDock';
import { DmDecisionRecapPanel } from '../components/game/DmDecisionRecapPanel';
import { ChronicleDrawer } from '../components/game/ChronicleDrawer';
import { audioManager } from '../audio/audioManager';
import { useAudioSettings } from '../audio/useAudioSettings';
import { useTtsSettings } from '../tts/useTtsSettings';
import { narrationTtsService } from '../tts/narrationTtsService';
import { useCapabilities } from '../hooks/useCapabilities';
import { NarrationTtsButton } from '../components/NarrationTtsButton';
import { KeybindingsHelp } from '../components/KeybindingsHelp';

interface LastSubmittedAction {
  label: string;
  stat: string;
  char: Character | null;
  difficulty: string;
  difficultyValue?: number;
}

export const SessionPage = () => {
  const { settings, setMasterMuted } = useAudioSettings();
  const { settings: ttsSettings } = useTtsSettings();
  const { capabilities } = useCapabilities();
  const lastSpokenTurnIdRef = useRef<number | null>(null);
  const imageLoadingRef = useRef(false);
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
  const [confirmDialog, setConfirmDialog] = useState<{message: string; confirmLabel?: string; onConfirm: () => void} | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [lastRoll, setLastRoll] = useState<{ roll: number; success: boolean; stat: string; statBonus?: number; itemBonus?: number; isCritical?: boolean; difficultyTarget?: number; rollNarration?: string; hpChanges?: HpChange[]; inventoryChanges?: InventoryChange[] } | null>(null);
  const [dieExiting, setDieExiting] = useState(false);
  const [interventionBanner, setInterventionBanner] = useState<string | null>(null);
  const [sanctuaryBanner, setSanctuaryBanner] = useState<string | null>(null);
  const [showFullInventory, setShowFullInventory] = useState(false);
  const [showChronicle, setShowChronicle] = useState(false);
  const [showKeybindingsHelp, setShowKeybindingsHelp] = useState(false);
  const [lastSubmittedAction, setLastSubmittedAction] = useState<LastSubmittedAction | null>(null);
  const [currentTensionLevel, setCurrentTensionLevel] = useState<'low' | 'medium' | 'high' | null>(null);
  const [showBanner, setShowBanner] = useState(true);
  const displayTurnRef = useRef<TurnResult | null>(null);

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

  // TTS: auto-speak the latest narration once per new turn.
  useEffect(() => {
    if (loading || lastRoll) {
      return;
    }
    if (!ttsSettings.enabled || !ttsSettings.autoSpeakNarration) {
      return;
    }
    if (!narrationTtsService.isNarrationAvailable(ttsSettings, capabilities.hasTts, true)) {
      return;
    }
    const latestTurn = history[history.length - 1];
    if (!latestTurn?.narration || !latestTurn.id) {
      return;
    }
    if (lastSpokenTurnIdRef.current === latestTurn.id) {
      return;
    }
    lastSpokenTurnIdRef.current = latestTurn.id;
    narrationTtsService.speakNarration({
      text: latestTurn.narration,
      settings: ttsSettings,
      hasTts: capabilities.hasTts,
      turnId: latestTurn.id,
      mainNarration: true,
    });
  }, [history, loading, lastRoll, ttsSettings, capabilities.hasTts]);

  // Stop TTS when leaving session
  useEffect(() => {
    return () => {
      narrationTtsService.stopNarration();
    };
  }, []);

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
    const handler = (e: KeyboardEvent) => {
      const inTextField = (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT';
      if (inTextField) {
        return;
      }
      if (e.key === '?') {
        setShowKeybindingsHelp(h => !h);
      } else if (e.key === 'c') {
        setShowChronicle(prev => {
          if (prev) {
            setViewedTurnIdx(history.length - 1);
          }
          return !prev;
        });
      } else if (e.key === 'Escape') {
        if (showFullInventory) {
          setShowFullInventory(false);
        } else {
          setFullscreenNarration(null);
          setFullscreenImage(null);
        }
      } else if (e.key === 'n') {
        const narration = displayTurnRef.current?.narration;
        if (narration) {
          setFullscreenNarration(prev => (prev ? null : narration));
        }
      } else if (e.key === 'f') {
        const rawUrl = displayTurnRef.current?.imageUrl;
        const url = rawUrl ? imgSrc(rawUrl) : (!imageLoadingRef.current ? imgSrc('/images/default_scene.png') : null);
        if (url) {
          setFullscreenImage(prev => (prev ? null : url));
        }
      } else if (e.key === 'q') {
        setConfirmDialog({
          message: 'Exit this realm and return home?',
          confirmLabel: 'Exit',
          onConfirm: () => {
            audioManager.stopMusic();
            narrationTtsService.stopNarration();
            navigate('/');
          },
        });
      } else if (e.key === 'b') {
        setShowBanner(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [history.length, navigate, showFullInventory]);

  useSessionEvents({
    sessionId: id!,
    onGameOver: (updatedSession) => {
      setSession(updatedSession);
    },
    onNarrating: ({ action, statUsed, difficulty, difficultyValue, character }) => {
      setLoading(true);
      if (action && statUsed && difficulty && character) {
        setLastSubmittedAction(prev => prev ?? { label: action, stat: statUsed, difficulty, difficultyValue, char: character });
      }
    },
    onTurnComplete: (updatedSession, turnResult) => {
      setLoading(false);
      setLastSubmittedAction(null);
      setCustomAction('');
      if (turnResult?.currentTensionLevel) {
        setCurrentTensionLevel(turnResult.currentTensionLevel);
      }
      if (updatedSession) {
        setSession(updatedSession);
      }
      const roll = turnResult?.lastAction?.actionResult;
      if (roll && roll.statUsed !== 'none') {
        setLastRoll({
          roll: roll.roll,
          success: roll.success,
          stat: roll.statUsed,
          statBonus: roll.statBonus,
          itemBonus: roll.itemBonus,
          isCritical: roll.isCritical,
          difficultyTarget: roll.difficultyTarget,
          rollNarration: turnResult?.rollNarration,
          hpChanges: turnResult?.hpChanges,
          inventoryChanges: turnResult?.inventoryChanges,
        });
        setDieExiting(false);
        setTimeout(() => setDieExiting(true), 4000);
        setTimeout(() => {
          setLastRoll(null);
          setDieExiting(false);
        }, 4500);
      }
      if (turnResult) {
        setHistory(prev => {
          if (turnResult.id && prev.some(t => t.id === turnResult.id)) {
            return prev;
          }
          const next = [...prev, turnResult];
          setViewedTurnIdx(next.length - 1);
          return next;
        });
      }
    },
    onImageReady: (imageUrl) => {
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
        updated[updated.length - 1] = { ...last, imageUrl };
        return updated;
      });
    },
    onIntervention: (narration, updatedSession, turnResult) => {
      setInterventionBanner(narration);
      if (updatedSession) {
        setSession(updatedSession);
      }
      if (turnResult) {
        setHistory(prev => {
          const u = [...prev, turnResult];
          setViewedTurnIdx(u.length - 1);
          return u;
        });
      }
      setTimeout(() => setInterventionBanner(null), 8000);
    },
    onSanctuaryRecovery: (narration, updatedSession, turnResult) => {
      setSanctuaryBanner(narration);
      if (updatedSession) {
        setSession(updatedSession);
      }
      if (turnResult) {
        setHistory(prev => {
          const u = [...prev, turnResult];
          setViewedTurnIdx(u.length - 1);
          return u;
        });
      }
      setTimeout(() => setSanctuaryBanner(null), 10000);
    },
    onPartyUpdate: (updatedSession) => {
      if (updatedSession) {
        setSession(updatedSession);
      } else {
        joinSession(id!);
      }
    },
  });

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
    setLastSubmittedAction({ label: action, stat: statUsed, char: activeChar, difficulty, difficultyValue: difficultyValue ?? undefined });
    setLoading(true);
    audioManager.stopNarrating();
    narrationTtsService.stopNarration();
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
      setHistory(prev => {
        if (data.turnResult.id && prev.some(t => t.id === data.turnResult.id)) {
          return prev;
        }
        const next = [...prev, data.turnResult];
        setViewedTurnIdx(next.length - 1);
        return next;
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        setActionError(err.message);
      } else {
        setActionError('An unexpected error occurred');
      }
      setLoading(false);
      setLastSubmittedAction(null);
    }
  };

  if (!session) {
    return <PageLoader />;
  }

  if (session.gameOver) {
    return (
      <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-slate-100 flex flex-col items-center justify-center gap-8 p-8">
        <div className="flex flex-col items-center gap-4 max-w-lg text-center">
          <img
            src="/images/campaign_over.png"
            className="w-48 h-48 rounded-[32px] object-cover opacity-80 shadow-2xl"
            onError={e => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
            alt="Campaign Over"
          />
          <h1 className="text-5xl font-black uppercase tracking-tighter text-rose-500 italic">Campaign Over</h1>
          <p className="text-slate-400 text-lg font-medium leading-relaxed">
            The party has fallen and there are no more rescues remaining. The campaign of <span className="text-amber-400 font-black">{session.displayName}</span> has ended.
          </p>
          <p className="text-slate-600 text-sm italic">Their legend lives on in the chronicle.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
          <button
            onClick={() => navigate(`/session/${session.id}/recap`)}
            className="flex-1 py-4 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-600/40 hover:border-amber-500/60 rounded-2xl font-black uppercase tracking-widest text-amber-400 text-sm transition-all"
          >
            View Chronicle
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-2xl font-black uppercase tracking-widest text-slate-400 text-sm transition-all"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  const displayTurn = history[viewedTurnIdx] ?? null;
  displayTurnRef.current = displayTurn;
  imageLoadingRef.current = imageLoading;
  const activeChar = session.party.find(c => c.id === session.activeCharacterId) || null;
  const isDown = activeChar?.status === 'downed';
  const partyItemCount = session.party.reduce((s, c) => s + c.inventory.length, 0);

  const handleExitClick = () => {
    setConfirmDialog({
      message: 'Exit this realm and return home?',
      onConfirm: () => {
        audioManager.stopMusic();
        narrationTtsService.stopNarration();
        navigate('/');
      },
    });
  };

  return (
    <div className="bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-slate-100 overflow-x-hidden lg:h-dvh lg:overflow-hidden">
      {showBanner && (
        <SessionHud
          session={session}
          onCharacterClick={setSelectedCharacter}
        />
      )}

      {/* Top-right controls */}
      {showBanner ? (
        <div className="fixed top-3 right-4 z-[70] flex items-center gap-1.5 pointer-events-auto">
          <div className="relative group">
            <button
              onClick={() => setShowBanner(false)}
              className="w-9 h-9 xl:w-11 xl:h-11 flex items-center justify-center rounded-xl border border-slate-700 text-slate-400 hover:bg-slate-800 hover:border-slate-500 hover:text-slate-200 text-sm xl:text-base transition-all"
              aria-label="Hide banner"
            >
              ▲
            </button>
            <div className="absolute top-full right-0 mt-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
              Hide banner [b]
              <div className="absolute bottom-full right-3 border-4 border-transparent border-b-slate-700" />
            </div>
          </div>
          <GearPopover
            savingsMode={session.savingsMode}
            onToggleSavingsMode={toggleSavingsMode}
            audioSettings={settings}
            onMuteToggle={() => {
              setMasterMuted(!settings.masterMuted);
              if (!settings.masterMuted) {
                narrationTtsService.stopNarration();
              }
            }}
          />
          <div className="relative group">
            <button
              onClick={handleExitClick}
              className="w-9 h-9 xl:w-11 xl:h-11 flex items-center justify-center rounded-xl border border-rose-900/60 text-rose-500 hover:bg-rose-900/20 hover:border-rose-700 hover:text-rose-300 font-black text-sm xl:text-base transition-all"
            >
              ✕
            </button>
            <div className="absolute top-full right-0 mt-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
              Exit realm [q]
              <div className="absolute bottom-full right-3 border-4 border-transparent border-b-slate-700" />
            </div>
          </div>
        </div>
      ) : (
        <div className="fixed top-3 right-4 z-[70] group pointer-events-auto">
          <button
            onClick={() => setShowBanner(true)}
            className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-700 text-[9px] font-black text-slate-500 hover:text-slate-300 hover:border-slate-500 transition-all shadow-lg"
            aria-label="Show banner"
          >
            ▼
          </button>
          <div className="absolute top-full right-0 mt-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
            Show banner [b]
            <div className="absolute bottom-full right-3 border-4 border-transparent border-b-slate-700" />
          </div>
        </div>
      )}

      <div className={`flex flex-col lg:flex-row gap-4 px-4 pb-4 h-dvh overflow-hidden ${showBanner ? 'pt-36 sm:pt-24' : 'pt-3'}`}>
        {/* Top / Left: Story Stage */}
        <div className="flex-shrink-0 h-[40vh] lg:h-auto lg:flex-1 lg:min-w-0 lg:min-h-0">
          <StoryStage
            history={history}
            viewedTurnIdx={viewedTurnIdx}
            imageLoading={imageLoading}
            ttsSettings={ttsSettings}
            hasTts={capabilities.hasTts}
            chronicleOpen={showChronicle}
            currentTensionLevel={currentTensionLevel}
            onOpenChronicle={() => setShowChronicle(true)}
            onFullscreenImage={setFullscreenImage}
            onFullscreenNarration={setFullscreenNarration}
          />
        </div>

        {/* Bottom / Right: Chronicle / Action area */}
        <div className="flex-1 min-h-0 lg:flex-none lg:flex-shrink-0 lg:w-[380px] xl:w-[440px] 2xl:w-[500px] lg:min-h-0">
          {showChronicle ? (
            <ChronicleDrawer
              history={history}
              party={session.party}
              onClose={() => {
                setShowChronicle(false);
                setViewedTurnIdx(history.length - 1);
              }}
              onSelectTurn={setViewedTurnIdx}
              viewedTurnIdx={viewedTurnIdx}
              ttsSettings={ttsSettings}
              hasTts={capabilities.hasTts}
            />
          ) : loading ? (
            <DmDecisionRecapPanel lastSubmittedAction={lastSubmittedAction} ttsSettings={ttsSettings} />
          ) : (
            <ActionDock
              turn={displayTurn}
              loading={loading}
              activeCharacter={activeChar}
              isDown={isDown}
              party={session.party}
              sessionId={session.id}
              customAction={customAction}
              setCustomAction={setCustomAction}
              error={actionError}
              onSubmit={submitAction}
              onUseItem={(ownerCharId, itemId, targetCharId) => submitAction('use item', 'none', 'easy', null, ownerCharId, itemId, targetCharId)}
              onGiveItem={(ownerCharId, itemId, targetCharId) => submitAction('give item', 'none', 'easy', null, ownerCharId, itemId, targetCharId)}
              onShowPartyGear={() => setShowFullInventory(true)}
              partyItemCount={partyItemCount}
            />
          )}
        </div>
      </div>

      {/* Roll popup */}
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
              className="text-base"
            />
            {lastRoll.rollNarration && (
              <p className="text-amber-100/90 text-center font-medium italic mt-2 max-w-xs leading-tight animate-in slide-in-from-bottom-2 duration-700">
                {lastRoll.rollNarration}
              </p>
            )}
            {lastRoll.hpChanges && lastRoll.hpChanges.length > 0 && (
              <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                {lastRoll.hpChanges.map(hc => (
                  <div
                    key={hc.characterId}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-widest border ${hc.change < 0 ? 'bg-rose-900/40 border-rose-700/50 text-rose-400' : 'bg-emerald-900/40 border-emerald-700/50 text-emerald-400'}`}
                  >
                    <span>{hc.change < 0 ? '' : '+'}{hc.change}</span>
                    <span className="opacity-70 normal-case tracking-normal font-semibold">{hc.characterName.split(' ')[0]}</span>
                    <span className="opacity-50 text-[10px]">{hc.newHp}/{hc.maxHp}</span>
                  </div>
                ))}
              </div>
            )}
            {lastRoll.inventoryChanges && lastRoll.inventoryChanges.length > 0 && (
              <div className="flex flex-wrap gap-1.5 justify-center mt-2">
                {lastRoll.inventoryChanges.map((ic, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black border ${ic.type === 'added' ? 'bg-amber-900/40 border-amber-700/50 text-amber-400' : 'bg-slate-800/60 border-slate-700/50 text-slate-400'}`}
                  >
                    <span>{ic.type === 'added' ? '＋' : '－'}</span>
                    <span className="normal-case tracking-normal font-semibold">{ic.itemName}</span>
                    <span className="opacity-60">→ {ic.characterName.split(' ')[0]}</span>
                  </div>
                ))}
              </div>
            )}
            <span className="text-[10px] uppercase tracking-widest text-slate-600 mt-2">tap to dismiss</span>
          </div>
        </div>
      )}

      {/* Full inventory modal */}
      {showFullInventory && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in p-4"
          onClick={() => setShowFullInventory(false)}
        >
          <div onClick={e => e.stopPropagation()} className="bg-slate-900 border border-slate-700 rounded-[40px] p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl">
            <Inventory
              party={session.party}
              activeCharacterId={session.activeCharacterId}
              onUseItem={(ownerCharId, itemId, targetCharId) => {
                submitAction('use item', 'none', 'easy', null, ownerCharId, itemId, targetCharId);
                setShowFullInventory(false);
              }}
              onGiveItem={(ownerCharId, itemId, targetCharId) => {
                submitAction('give item', 'none', 'easy', null, ownerCharId, itemId, targetCharId);
                setShowFullInventory(false);
              }}
              disabled={loading}
            />
          </div>
        </div>
      )}

      {/* Fullscreen image */}
      {fullscreenImage && <FullscreenImage url={fullscreenImage} onClose={() => setFullscreenImage(null)} />}

      {/* Fullscreen narration */}
      {fullscreenNarration && (
        <div
          className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950 animate-in fade-in"
          onClick={() => setFullscreenNarration(null)}
        >
          <div className="min-h-full flex items-center justify-center p-8 md:p-16">
            <div className="max-w-4xl ultrawide:max-w-7xl w-full text-center">
              <p className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl 2xl:text-7xl 3xl:text-8xl 4xl:text-8xl ultrawide:text-8xl font-serif leading-snug text-slate-100 font-medium italic">
                {fullscreenNarration}
              </p>
              {narrationTtsService.isNarrationAvailable(ttsSettings, capabilities.hasTts, true) && (
                <div className="flex items-center justify-center gap-4 mt-10" onClick={e => e.stopPropagation()}>
                  <NarrationTtsButton
                    text={fullscreenNarration}
                    ttsSettings={ttsSettings}
                    hasTts={capabilities.hasTts}
                    turnId={displayTurn?.id}
                    className="justify-center"
                  />
                </div>
              )}
              <span className="text-xs uppercase tracking-widest text-slate-600 mt-8 block">tap to dismiss</span>
            </div>
          </div>
        </div>
      )}

      {/* Intervention banner */}
      {interventionBanner && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-amber-950/90 p-8 animate-in fade-in">
          <div className="max-w-xl text-center space-y-4">
            <div className="text-6xl">🐉</div>
            <p className="text-amber-100 text-center text-2xl font-display font-black italic leading-snug">{interventionBanner}</p>
          </div>
        </div>
      )}

      {/* Sanctuary banner */}
      {sanctuaryBanner && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/90 p-8 animate-in fade-in">
          <div className="max-w-xl text-center space-y-4">
            <div className="text-6xl">✨</div>
            <p className="text-slate-200 text-center text-2xl font-display font-black italic leading-snug">{sanctuaryBanner}</p>
            <span className="text-xs text-slate-600 uppercase tracking-widest">tap to continue</span>
          </div>
        </div>
      )}

      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={() => {
            confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {selectedCharacter && (
        <CharacterPopup
          character={selectedCharacter}
          onClose={() => setSelectedCharacter(null)}
          onAvatarClick={url => {
            setSelectedCharacter(null);
            setFullscreenImage(url);
          }}
        />
      )}
      {showKeybindingsHelp && (
        <KeybindingsHelp
          onClose={() => setShowKeybindingsHelp(false)}
          bindings={[
            { key: '1 / 2 / 3', action: 'Focus action choice (Enter submits)' },
            { key: '4', action: 'Focus custom action input' },
            { key: 'v', action: 'Start voice action' },
            { key: 'i', action: 'Open inventory' },
            { key: 'n', action: 'Toggle fullscreen narration' },
            { key: 'f', action: 'Toggle fullscreen image' },
            { key: 'c', action: 'Open / close Chronicle' },
            { key: '← ↓ / h j = older · → ↑ / l k = newer', action: 'Navigate turns (Chronicle open)' },
            { key: 'Enter', action: 'Expand turn detail (Chronicle open)' },
            { key: 's', action: 'Open / close settings' },
            { key: 'q', action: 'Exit realm (with confirm)' },
            { key: 'b', action: 'Toggle banner' },
            { key: 'Esc', action: 'Close overlays / blur input' },
            { key: '?', action: 'Toggle this help' },
          ]}
        />
      )}
    </div>
  );
};
