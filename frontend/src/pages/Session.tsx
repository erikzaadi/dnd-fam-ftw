import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session, Character, TurnResult, HpChange } from '../types';
import { apiFetch } from '../lib/api';
import { useSessionEvents } from '../hooks/useSessionEvents';
import { PageLoader } from '../components/PageLoader';
import { CharacterPopup } from '../components/CharacterPopup';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FullscreenImage } from '../components/FullscreenImage';
import { Inventory } from '../components/game/Inventory';
import { RollBreakdown } from '../components/game/RollBreakdown';
import { D20 } from '../components/game/D20';
import { SessionHud } from '../components/game/SessionHud';
import { StoryStage } from '../components/game/StoryStage';
import { ActionDock } from '../components/game/ActionDock';
import { DmDecisionRecapPanel } from '../components/game/DmDecisionRecapPanel';
import { ChronicleDrawer } from '../components/game/ChronicleDrawer';
import { audioManager } from '../audio/audioManager';
import { useAudioSettings } from '../audio/useAudioSettings';
import { useTtsSettings } from '../tts/useTtsSettings';
import { browserTtsService } from '../tts/browserTtsService';

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
  const lastSpokenTurnIdRef = useRef<number | null>(null);
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
  const [lastRoll, setLastRoll] = useState<{ roll: number; success: boolean; stat: string; statBonus?: number; itemBonus?: number; isCritical?: boolean; difficultyTarget?: number; rollNarration?: string; hpChanges?: HpChange[] } | null>(null);
  const [dieExiting, setDieExiting] = useState(false);
  const [interventionBanner, setInterventionBanner] = useState<string | null>(null);
  const [sanctuaryBanner, setSanctuaryBanner] = useState<string | null>(null);
  const [showFullInventory, setShowFullInventory] = useState(false);
  const [showChronicle, setShowChronicle] = useState(false);
  const [lastSubmittedAction, setLastSubmittedAction] = useState<LastSubmittedAction | null>(null);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [currentTensionLevel, setCurrentTensionLevel] = useState<'low' | 'medium' | 'high' | null>(null);

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
    if (!browserTtsService.isSupported()) {
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
    browserTtsService.speakNarration(latestTurn.narration, ttsSettings);
  }, [history, loading, lastRoll, ttsSettings]);

  // Stop TTS when leaving session
  useEffect(() => {
    return () => {
      browserTtsService.stop();
    };
  }, []);

  // Poll TTS playing state for fullscreen narration Stop button
  useEffect(() => {
    if (!ttsSettings.enabled || !browserTtsService.isSupported()) {
      return;
    }
    const interval = setInterval(() => {
      setTtsPlaying(prev => {
        const speaking = browserTtsService.isSpeaking();
        return prev === speaking ? prev : speaking;
      });
    }, 200);
    return () => clearInterval(interval);
  }, [ttsSettings.enabled]);

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

  useSessionEvents({
    sessionId: id!,
    onNarrating: () => setLoading(true),
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
    browserTtsService.stop();
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

  const displayTurn = history[viewedTurnIdx] ?? null;
  const activeChar = session.party.find(c => c.id === session.activeCharacterId) || null;
  const isDown = activeChar?.status === 'downed';
  const partyItemCount = session.party.reduce((s, c) => s + c.inventory.length, 0);

  return (
    <div className="h-screen flex flex-col bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-slate-100 overflow-hidden">
      <SessionHud
        session={session}
        onCharacterClick={setSelectedCharacter}
        savingsMode={session.savingsMode}
        onToggleSavingsMode={toggleSavingsMode}
        audioSettings={settings}
        onMuteToggle={() => {
          setMasterMuted(!settings.masterMuted);
          if (!settings.masterMuted) {
            browserTtsService.stop();
          }
        }}
      />

      <div className="flex-1 flex flex-col lg:flex-row gap-4 px-4 pb-4 pt-3 min-h-0 overflow-y-auto lg:overflow-hidden">
        {/* Top / Left: Story Stage */}
        <div className="flex-shrink-0 h-[50vh] lg:h-auto lg:flex-1 lg:min-w-0 lg:min-h-0">
          <StoryStage
            history={history}
            viewedTurnIdx={viewedTurnIdx}
            imageLoading={imageLoading}
            ttsSettings={ttsSettings}
            chronicleOpen={showChronicle}
            currentTensionLevel={currentTensionLevel}
            onOpenChronicle={() => setShowChronicle(true)}
            onFullscreenImage={setFullscreenImage}
            onFullscreenNarration={setFullscreenNarration}
          />
        </div>

        {/* Bottom / Right: Chronicle / Action area */}
        <div className="flex-shrink-0 lg:w-[380px] xl:w-[420px] lg:min-h-0">
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
              className="text-sm"
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
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950 p-8 md:p-16 animate-in fade-in"
          onClick={() => setFullscreenNarration(null)}
        >
          <div className="max-w-4xl w-full text-center">
            <p className="text-3xl md:text-5xl lg:text-6xl font-serif leading-snug text-slate-100 font-medium italic">
              {fullscreenNarration}
            </p>
            {ttsSettings.enabled && browserTtsService.isSupported() && (
              <div className="flex items-center justify-center gap-4 mt-10" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => browserTtsService.speakNarration(fullscreenNarration, ttsSettings)}
                  className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-amber-400 hover:border-amber-500/40 text-xs font-black uppercase tracking-widest transition-all"
                >
                  Replay
                </button>
                {ttsPlaying && (
                  <button
                    onClick={() => browserTtsService.stop()}
                    className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-rose-400 hover:border-rose-500/40 text-xs font-black uppercase tracking-widest transition-all"
                  >
                    Stop
                  </button>
                )}
              </div>
            )}
            <span className="text-xs uppercase tracking-widest text-slate-600 mt-8 block">tap to dismiss</span>
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
    </div>
  );
};
