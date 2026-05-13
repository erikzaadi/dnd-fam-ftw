import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Session, Character, TurnResult, HpChange, InventoryChange, FreeActionPreview } from '../types';
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
import { FreeActionConfirmDialog } from '../components/game/FreeActionConfirmDialog';
import { DmDecisionRecapPanel } from '../components/game/DmDecisionRecapPanel';
import { EncounterPanel } from '../components/game/EncounterPanel';
import { ChronicleDrawer } from '../components/game/ChronicleDrawer';
import { audioManager } from '../audio/audioManager';
import { useAudioSettings } from '../audio/useAudioSettings';
import { useTtsSettings } from '../tts/useTtsSettings';
import { narrationTtsService } from '../tts/narrationTtsService';
import { useCapabilities } from '../hooks/useCapabilities';
import { Tooltip } from '../components/Tooltip';
import { NarrationTtsButton } from '../components/NarrationTtsButton';
import { KeybindingsHelp } from '../components/KeybindingsHelp';
import { OnboardingOverlay } from '../components/OnboardingOverlay';
import { useOnboardingTutorial } from '../hooks/useOnboardingTutorial';
import { getRollImpactOutcome } from '../lib/rollOutcome';

interface LastSubmittedAction {
  label: string;
  stat: string;
  char: Character | null;
  difficulty: string;
  difficultyValue?: number;
  helperBonus?: number;
  helperCharacterName?: string;
  choiceItemBonus?: number;
  choiceItemName?: string;
  choiceItemOwnerName?: string;
  characterBonus?: number;
  characterBonusLabel?: string;
  flavor?: string;
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
  const [previewThinking, setPreviewThinking] = useState(false);
  const [customAction, setCustomAction] = useState("");
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [fullscreenNarration, setFullscreenNarration] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{message: string; confirmLabel?: string; onConfirm: () => void} | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [lastRoll, setLastRoll] = useState<{ roll: number; success: boolean; stat: string; statBonus?: number; itemBonus?: number; helperBonus?: number; helperCharacterName?: string; choiceItemBonus?: number; choiceItemName?: string; choiceItemOwnerName?: string; characterBonus?: number; characterBonusLabel?: string; buffBonus?: number; buffBonusLabel?: string; impact?: 'normal' | 'strong' | 'extreme'; isCritical?: boolean; difficultyTarget?: number; rollNarration?: string; hpChanges?: HpChange[]; inventoryChanges?: InventoryChange[] } | null>(null);
  const [dieExiting, setDieExiting] = useState(false);
  const [interventionBanner, setInterventionBanner] = useState<string | null>(null);
  const [sanctuaryBanner, setSanctuaryBanner] = useState<string | null>(null);
  const [showFullInventory, setShowFullInventory] = useState(false);
  const [showChronicle, setShowChronicle] = useState(false);
  const [showKeybindingsHelp, setShowKeybindingsHelp] = useState(false);
  const [lastSubmittedAction, setLastSubmittedAction] = useState<LastSubmittedAction | null>(null);
  const [gearActionPreview, setGearActionPreview] = useState<FreeActionPreview | null>(null);
  const [gearPreviewSubmitting, setGearPreviewSubmitting] = useState(false);
  const [currentTensionLevel, setCurrentTensionLevel] = useState<'low' | 'medium' | 'high' | null>(null);
  const [showBanner, setShowBanner] = useState(true);
  const [gearOpen, setGearOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const showBannerRef = useRef(showBanner);
  showBannerRef.current = showBanner;
  const [storyFocusRequest, setStoryFocusRequest] = useState(0);
  const { step: tutorialStep, advance: advanceTutorial } = useOnboardingTutorial({
    isLoading: loading,
    lastRollVisible: !!lastRoll,
  });
  const displayTurnRef = useRef<TurnResult | null>(null);
  const pendingStoryFocusRef = useRef(false);

  const requestStoryFocus = useCallback(() => {
    setStoryFocusRequest(version => version + 1);
  }, []);

  const closeRollPopup = useCallback(() => {
    setLastRoll(null);
    setDieExiting(false);
    if (pendingStoryFocusRef.current) {
      pendingStoryFocusRef.current = false;
      requestStoryFocus();
    }
  }, [requestStoryFocus]);

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
        closeRollPopup();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeRollPopup, lastRoll]);

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
      } else if (e.key === 's') {
        if (!showBannerRef.current) {
          setShowBanner(true);
        }
        setGearOpen(o => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [history.length, navigate, showFullInventory]);

  const { connectionState } = useSessionEvents({
    sessionId: id!,
    onGameOver: (updatedSession) => {
      setSession(updatedSession);
    },
    onNarrating: ({ action, statUsed, difficulty, difficultyValue, character, ...preview }) => {
      setLoading(true);
      if (action && statUsed && difficulty && character) {
        setLastSubmittedAction(prev => prev
	  ? { ...prev, ...preview }
	  : { label: action, stat: statUsed, difficulty, difficultyValue, char: character, ...preview });
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
      const hasRollDetails = !!roll && roll.statUsed !== 'none';
      if (hasRollDetails) {
        setLastRoll({
          roll: roll.roll,
          success: roll.success,
          stat: roll.statUsed,
          statBonus: roll.statBonus,
          itemBonus: roll.itemBonus,
          helperBonus: roll.helperBonus,
          helperCharacterName: roll.helperCharacterName,
          choiceItemBonus: roll.choiceItemBonus,
          choiceItemName: roll.choiceItemName,
          choiceItemOwnerName: roll.choiceItemOwnerName,
          characterBonus: roll.characterBonus,
          characterBonusLabel: roll.characterBonusLabel,
          buffBonus: roll.buffBonus,
          buffBonusLabel: roll.buffBonusLabel,
          impact: roll.impact,
          isCritical: roll.isCritical,
          difficultyTarget: roll.difficultyTarget,
          rollNarration: turnResult?.rollNarration,
          hpChanges: turnResult?.hpChanges,
          inventoryChanges: turnResult?.inventoryChanges,
        });
        setDieExiting(false);
        setTimeout(() => setDieExiting(true), 4000);
        setTimeout(() => {
          closeRollPopup();
        }, 4500);
      }
      if (turnResult) {
        setHistory(prev => {
          if (turnResult.id && prev.some(t => t.id === turnResult.id)) {
            if (hasRollDetails) {
              pendingStoryFocusRef.current = true;
            }
            return prev;
          }
          const next = [...prev, turnResult];
          setViewedTurnIdx(next.length - 1);
          if (hasRollDetails) {
            pendingStoryFocusRef.current = true;
          } else {
            requestStoryFocus();
          }
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
    if (enabled) {
      setImageLoading(false);
    }
    setSession({ ...session, savingsMode: enabled });
  };

  const submitAction = async (action: string, statUsed: string = 'none', difficulty: string = 'normal', difficultyValue: number | null = null, ownerCharId: string | null = null, itemId: string | null = null, targetCharId: string | null = null, preview: Partial<LastSubmittedAction> = {}, actionIntent?: string) => {
    if (!session) {
      return;
    }
    setActionError(null);
    const itemOwner = ownerCharId ? session.party.find(c => c.id === ownerCharId) ?? null : activeChar;
    const itemTarget = targetCharId ? session.party.find(c => c.id === targetCharId) ?? null : null;
    const item = itemOwner && itemId ? itemOwner.inventory.find(i => i.id === itemId) ?? null : null;
    const actionType = itemId ? (action === 'use item' ? 'use_item' : 'give_item') : undefined;
    const displayAction = actionType === 'give_item' && item && itemTarget
      ? `${itemOwner?.name ?? 'Someone'} gave ${item.name} to ${itemTarget.name}`
      : actionType === 'use_item' && item && itemTarget
        ? `${itemOwner?.name ?? 'Someone'} used ${item.name} on ${itemTarget.name}`
        : action;
    setLastSubmittedAction({ label: displayAction, stat: statUsed, char: itemOwner, difficulty, difficultyValue: difficultyValue ?? undefined, ...preview });
    setLoading(true);
    setMobileActionsOpen(false);
    audioManager.stopNarrating();
    narrationTtsService.stopNarration();
    try {
      const res = await apiFetch(`/session/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          statUsed,
          difficulty,
          difficultyValue,
          characterId: ownerCharId ?? undefined,
          actionType,
          itemId: itemId ?? undefined,
          targetCharacterId: targetCharId ?? undefined,
          ...(actionIntent && { actionIntent }),
        }),
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
        requestStoryFocus();
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

  const previewGearAction = async (ownerCharId: string, itemId: string) => {
    if (!session || loading) {
      return;
    }

    const owner = session.party.find(c => c.id === ownerCharId);
    const item = owner?.inventory.find(i => i.id === itemId);
    if (!owner || !item || owner.id !== session.activeCharacterId) {
      return;
    }

    setActionError(null);
    setShowFullInventory(false);
    await previewSceneAction({
      intent: 'use_item_scene',
      itemOwnerCharacterId: owner.id,
      itemId: item.id,
    }, {
      choiceItemBonus: 2,
      choiceItemName: item.name,
      choiceItemOwnerName: owner.name,
      flavor: 'item',
    }, `Use ${item.name} to help with the current situation`);
  };

  const previewSceneAction = async (
    request: { action?: string; intent?: string; targetCharacterId?: string; itemOwnerCharacterId?: string; itemId?: string; method?: string },
    defaults: Partial<FreeActionPreview> = {},
    fallbackAction = request.action ?? 'Try a support action for the current situation',
  ) => {
    const actionText = request.action ?? fallbackAction;
    let preview: FreeActionPreview = {
      originalAction: actionText,
      interpretedAction: actionText,
      stat: 'mischief',
      difficulty: 'normal',
      warnings: [],
      ...defaults,
    };

    try {
      const res = await apiFetch(`/session/${id}/preview-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (res.ok) {
        const responsePreview = await res.json() as Partial<FreeActionPreview>;
        preview = {
          ...preview,
          ...responsePreview,
          originalAction: responsePreview.originalAction ?? actionText,
          interpretedAction: responsePreview.interpretedAction ?? actionText,
          warnings: responsePreview.warnings ?? [],
          choiceItemBonus: responsePreview.choiceItemBonus ?? preview.choiceItemBonus,
          choiceItemName: responsePreview.choiceItemName ?? preview.choiceItemName,
          choiceItemOwnerName: responsePreview.choiceItemOwnerName ?? preview.choiceItemOwnerName,
          flavor: responsePreview.flavor ?? preview.flavor,
        };
      } else {
        preview = {
          ...preview,
          warnings: ['Preview failed - submitting with default stat. You can still confirm or cancel.'],
        };
      }
    } catch {
      preview = {
        ...preview,
        warnings: ['Preview failed - submitting with default stat. You can still confirm or cancel.'],
      };
    }
    setGearActionPreview({
      ...preview,
      ...(request.intent && { pendingIntent: request.intent }),
      ...(request.targetCharacterId && { pendingTargetCharacterId: request.targetCharacterId }),
    });
  };

  const previewImproveGearAction = async (ownerCharId: string, itemId: string, method: 'enchant' | 'craft' | 'tinker') => {
    if (!session || loading || previewThinking) {
      return;
    }
    const owner = session.party.find(c => c.id === ownerCharId);
    const item = owner?.inventory.find(i => i.id === itemId);
    const actor = session.party.find(c => c.id === session.activeCharacterId);
    if (!owner || !item || !actor || actor.status === 'downed') {
      return;
    }

    setActionError(null);
    setShowFullInventory(false);
    setPreviewThinking(true);
    await previewSceneAction({
      intent: 'improve_item',
      itemOwnerCharacterId: owner.id,
      itemId: item.id,
      method,
    }, {
      choiceItemBonus: 2,
      choiceItemName: item.name,
      choiceItemOwnerName: owner.name,
      flavor: 'item',
    }, `${actor.name} tries to ${method} ${owner.name}'s ${item.name}`);
    setPreviewThinking(false);
  };

  const previewCharacterSupportAction = async (targetCharacterId: string, kind: 'bless' | 'aid') => {
    if (!session || loading || previewThinking) {
      return;
    }
    const actor = session.party.find(c => c.id === session.activeCharacterId);
    const target = session.party.find(c => c.id === targetCharacterId);
    if (!actor || !target || actor.id === target.id || actor.status === 'downed' || target.status === 'downed') {
      return;
    }

    setActionError(null);
    setSelectedCharacter(null);
    setPreviewThinking(true);
    await previewSceneAction({
      intent: kind === 'bless' ? 'bless_character' : 'aid_character',
      targetCharacterId: target.id,
    }, {
      characterBonus: 2,
      characterBonusLabel: kind === 'bless' ? 'spotlight' : 'social edge',
      flavor: kind === 'bless' ? 'spotlight' : 'social',
    }, kind === 'bless'
      ? `${actor.name} blesses ${target.name} with short-lived protective magic`
      : `${actor.name} aids ${target.name} with a coordinated setup`);
    setPreviewThinking(false);
  };

  const previewPartyBoostAction = async () => {
    if (!session || loading || previewThinking) {
      return;
    }
    const actor = session.party.find(c => c.id === session.activeCharacterId);
    if (!actor || actor.status === 'downed') {
      return;
    }

    const strongest = ([
      { stat: 'might' as const, value: actor.stats.might },
      { stat: 'magic' as const, value: actor.stats.magic },
      { stat: 'mischief' as const, value: actor.stats.mischief },
    ].sort((a, b) => b.value - a.value)[0]?.stat) ?? 'mischief';
    setPreviewThinking(true);
    await previewSceneAction({ intent: 'party_boost' }, {
      characterBonus: 2,
      characterBonusLabel: strongest === 'magic' ? 'spotlight' : 'social edge',
      flavor: strongest === 'magic' ? 'spotlight' : 'social',
    }, `${actor.name} rallies the whole party with a short-lived boost`);
    setPreviewThinking(false);
  };

  const confirmGearAction = async () => {
    if (!gearActionPreview) {
      return;
    }
    setGearPreviewSubmitting(true);
    const preview: Partial<LastSubmittedAction> = {
      ...(gearActionPreview.helperBonus !== undefined && { helperBonus: gearActionPreview.helperBonus }),
      ...(gearActionPreview.helperCharacterName !== undefined && { helperCharacterName: gearActionPreview.helperCharacterName }),
      ...(gearActionPreview.choiceItemBonus !== undefined && { choiceItemBonus: gearActionPreview.choiceItemBonus }),
      ...(gearActionPreview.choiceItemName !== undefined && { choiceItemName: gearActionPreview.choiceItemName }),
      ...(gearActionPreview.choiceItemOwnerName !== undefined && { choiceItemOwnerName: gearActionPreview.choiceItemOwnerName }),
      ...(gearActionPreview.characterBonus !== undefined && { characterBonus: gearActionPreview.characterBonus }),
      ...(gearActionPreview.characterBonusLabel !== undefined && { characterBonusLabel: gearActionPreview.characterBonusLabel }),
      ...(gearActionPreview.flavor !== undefined && { flavor: gearActionPreview.flavor }),
    };
    const { interpretedAction, stat, difficulty, difficultyValue, pendingIntent, pendingTargetCharacterId } = gearActionPreview;
    setGearActionPreview(null);
    setGearPreviewSubmitting(false);
    await submitAction(interpretedAction, stat, difficulty, difficultyValue ?? null, null, null, pendingTargetCharacterId ?? null, preview, pendingIntent);
  };

  const editGearAction = () => {
    if (!gearActionPreview) {
      return;
    }
    setCustomAction(gearActionPreview.interpretedAction);
    setGearActionPreview(null);
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
  const stageFullscreenImageUrl = displayTurn?.imageUrl
    ? imgSrc(displayTurn.imageUrl)
    : (!imageLoading && !session.savingsMode ? imgSrc('/images/default_scene.png') : null);
  const activeChar = session.party.find(c => c.id === session.activeCharacterId) || null;
  const isDown = activeChar?.status === 'downed';

  const lastRollOutcome = getRollImpactOutcome(lastRoll?.roll, lastRoll?.success, lastRoll?.impact);
  const animateRollGlow = lastRollOutcome && (lastRoll?.impact === 'extreme' || lastRoll?.roll === 1 || lastRoll?.roll === 20);
  const showNarrationOnlyLoading = loading && !lastRoll;
  const showStoryOnlyMobile = !loading && !mobileActionsOpen && tutorialStep !== 3;
  const showMobileActionsOverlay = !loading && (mobileActionsOpen || tutorialStep === 3);
  const sessionGridRows = showNarrationOnlyLoading
    ? 'grid-rows-[minmax(0,1fr)]'
    : showStoryOnlyMobile
      ? 'grid-rows-[minmax(0,1fr)]'
      : 'grid-rows-[minmax(0,2fr)_minmax(0,3fr)]';
  const showInlineActionPanel = loading;
  const actionAreaClass = showInlineActionPanel
    ? 'block'
    : 'hidden xl:block';

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

  const handleChronicleSelectTurn = (idx: number) => {
    setViewedTurnIdx(prev => {
      if (prev !== idx) {
        narrationTtsService.stopNarration();
      }
      return idx;
    });
  };

  return (
    <div className="min-h-dvh bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-slate-100 overflow-x-hidden xl:h-dvh xl:overflow-hidden">
      {showBanner && (
        <SessionHud
          session={session}
          onCharacterClick={setSelectedCharacter}
          previewThinking={previewThinking}
          onPartyBoost={() => {
            void previewPartyBoostAction();
          }}
        />
      )}

      {/* Reconnecting indicator */}
      {connectionState === 'reconnecting' && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2 px-3 py-1.5 bg-slate-900/90 border border-slate-700 rounded-full backdrop-blur-sm pointer-events-none">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs font-black uppercase tracking-widest text-slate-400">Reconnecting...</span>
        </div>
      )}

      {/* Top-right controls */}
      {showBanner ? (
        <div className="fixed top-3 right-4 z-[70] flex items-center gap-1.5 pointer-events-auto" data-tutorial="top-controls">
          <Tooltip content="Hide banner [b]" position="bottom" align="right" portal>
            <button
              onClick={() => setShowBanner(false)}
              className="w-11 h-11 flex items-center justify-center rounded-xl border border-slate-700 text-slate-400 hover:bg-slate-800 hover:border-slate-500 hover:text-slate-200 text-sm transition-all"
              aria-label="Hide banner"
            >
              ▲
            </button>
          </Tooltip>
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
            open={gearOpen}
            onOpenChange={setGearOpen}
          />
          <Tooltip content="Exit realm [q]" position="bottom" align="right" portal>
            <button
              onClick={handleExitClick}
              className="w-11 h-11 flex items-center justify-center rounded-xl border border-rose-900/60 text-rose-500 hover:bg-rose-900/20 hover:border-rose-700 hover:text-rose-300 font-black text-sm transition-all"
            >
              ✕
            </button>
          </Tooltip>
        </div>
      ) : (
        <div className="fixed top-3 right-4 z-[70] pointer-events-auto">
          <Tooltip content="Show banner [b]" position="bottom" align="right" portal>
            <button
              onClick={() => setShowBanner(true)}
              className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-700 text-[9px] font-black text-slate-500 hover:text-slate-300 hover:border-slate-500 transition-all shadow-lg"
              aria-label="Show banner"
            >
              ▼
            </button>
          </Tooltip>
        </div>
      )}

      {showChronicle && (
        <div className="fixed inset-0 z-[90] bg-slate-950/96 p-3">
          <ChronicleDrawer
            history={history}
            party={session.party}
            onClose={() => {
              setShowChronicle(false);
              setViewedTurnIdx(history.length - 1);
            }}
            onSelectTurn={handleChronicleSelectTurn}
            viewedTurnIdx={viewedTurnIdx}
            ttsSettings={ttsSettings}
            hasTts={capabilities.hasTts}
          />
        </div>
      )}

      {showMobileActionsOverlay && (
        <div className="fixed inset-0 z-[85] bg-slate-950 p-3 xl:hidden">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => setMobileActionsOpen(false)}
              className="rounded-full border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-slate-400"
            >
              Hide actions
            </button>
          </div>
          <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col gap-2">
            {session.encounterState && (
              <EncounterPanel encounter={session.encounterState} />
            )}
            <div className="min-h-0 flex-1">
              <ActionDock
                turn={displayTurn}
                loading={loading || previewThinking}
                previewThinking={previewThinking}
                activeCharacter={activeChar}
                isDown={isDown}
                party={session.party}
                sessionId={session.id}
                customAction={customAction}
                setCustomAction={setCustomAction}
                error={actionError}
                onSubmit={submitAction}
                onShowPartyGear={() => setShowFullInventory(true)}
                onCharacterClick={setSelectedCharacter}
              />
            </div>
          </div>
        </div>
      )}

      {!showChronicle && !loading && !showMobileActionsOverlay && (
        <nav className="fixed inset-x-3 bottom-3 z-[80] grid grid-cols-3 gap-2 rounded-2xl border border-slate-700/80 bg-slate-950/92 p-2 shadow-2xl backdrop-blur-md xl:hidden" aria-label="Session mobile tools">
          <button
            type="button"
            onClick={() => setMobileActionsOpen(true)}
            className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl bg-amber-500/12 px-2 py-2 text-[10px] font-black uppercase tracking-widest text-amber-300"
          >
            <span className="text-base leading-none">⚔</span>
            Actions
          </button>
          <button
            type="button"
            onClick={() => setShowChronicle(true)}
            className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl bg-slate-900 px-2 py-2 text-[10px] font-black uppercase tracking-widest text-slate-300"
          >
            <img src={imgSrc('/images/icon_scroll.png')} alt="" className="h-5 w-5 object-contain mix-blend-screen" />
            Chronicle
          </button>
          <button
            type="button"
            onClick={() => {
              if (stageFullscreenImageUrl) {
                setFullscreenImage(stageFullscreenImageUrl);
              }
            }}
            disabled={!stageFullscreenImageUrl}
            className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl bg-slate-900 px-2 py-2 text-[10px] font-black uppercase tracking-widest text-slate-300 disabled:opacity-40"
          >
            <span className="text-base leading-none">🖼</span>
            Art
          </button>
        </nav>
      )}

      {!showChronicle && (
        <div className="fixed bottom-4 left-4 z-[70] hidden xl:block">
          <Tooltip content="Open Chronicle [c]" position="top" align="left" portal>
            <button
              type="button"
              onClick={() => setShowChronicle(true)}
              className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-amber-500 shadow-xl backdrop-blur-md hover:border-amber-600/50 hover:bg-slate-900 hover:text-amber-300 transition-all"
              aria-label="Open Chronicle"
            >
              <img src={imgSrc('/images/icon_scroll.png')} alt="" className="h-5 w-5 object-contain mix-blend-screen" />
              Chronicle
            </button>
          </Tooltip>
        </div>
      )}

      <div className={`grid gap-4 px-4 pb-24 min-h-dvh grid-cols-1 ${sessionGridRows} xl:h-dvh xl:overflow-hidden xl:grid-cols-[minmax(0,1fr)_520px] xl:grid-rows-[1fr] xl:pb-4 ${showBanner ? 'pt-40 sm:pt-28' : 'pt-3'}`}>
        {/* Story Stage */}
        <div className={`min-h-[18rem] xl:min-h-0 ${showNarrationOnlyLoading ? 'hidden xl:block' : ''}`} data-tutorial="story-box">
          <StoryStage
            history={history}
            viewedTurnIdx={viewedTurnIdx}
            imageLoading={imageLoading && !session.savingsMode}
            ttsSettings={ttsSettings}
            hasTts={capabilities.hasTts}
            currentTensionLevel={currentTensionLevel}
            focusRequest={storyFocusRequest}
            onFullscreenImage={setFullscreenImage}
            onFullscreenNarration={setFullscreenNarration}
          />
        </div>

        {/* Chronicle / Action area: bottom-left on md, center col on xl */}
        <div className={`min-h-0 ${actionAreaClass}`} data-tutorial="action-dock">
          {loading ? (
            <DmDecisionRecapPanel lastSubmittedAction={lastSubmittedAction} ttsSettings={ttsSettings} />
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-2">
              {session.encounterState && (
                <EncounterPanel encounter={session.encounterState} />
              )}
              <div className="min-h-0 flex-1">
                <ActionDock
                  turn={displayTurn}
                  loading={loading || previewThinking}
                  previewThinking={previewThinking}
                  activeCharacter={activeChar}
                  isDown={isDown}
                  party={session.party}
                  sessionId={session.id}
                  customAction={customAction}
                  setCustomAction={setCustomAction}
                  error={actionError}
                  onSubmit={submitAction}
                  onShowPartyGear={() => setShowFullInventory(true)}
                  onCharacterClick={setSelectedCharacter}
                />
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Roll popup */}
      {lastRoll && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
          onClick={closeRollPopup}
        >
          <div
            className={`relative overflow-hidden bg-slate-900 border-2 ${lastRollOutcome?.containerClass ?? 'border-slate-700'} ${animateRollGlow ? 'critical-roll-popup' : ''} p-8 rounded-[40px] shadow-2xl text-center flex flex-col items-center animate-in zoom-in-95 ${dieExiting ? 'animate-out fade-out zoom-out-95' : ''}`}
            style={lastRollOutcome ? { '--critical-roll-glow': lastRollOutcome.popupGlow } as CSSProperties : undefined}
          >
            {lastRollOutcome && (
              <>
                <div className={`absolute inset-x-10 -top-20 h-40 blur-3xl ${lastRollOutcome.glowClass}`} />
                <div className={`relative z-10 mb-3 px-4 py-2 rounded-full border text-xs font-black uppercase tracking-[0.22em] ${lastRollOutcome.badgeClass}`}>
                  <span>{lastRollOutcome.label}</span>
                  <span className="mx-2 opacity-50">/</span>
                  <span className="opacity-80">{lastRollOutcome.detail}</span>
                </div>
              </>
            )}
            <D20 roll={lastRoll.roll} success={lastRoll.success} size={180} />
            <RollBreakdown
              roll={lastRoll.roll}
              statBonus={lastRoll.statBonus}
              itemBonus={lastRoll.itemBonus}
              helperBonus={lastRoll.helperBonus}
              helperCharacterName={lastRoll.helperCharacterName}
              choiceItemBonus={lastRoll.choiceItemBonus}
              choiceItemName={lastRoll.choiceItemName}
              characterBonus={lastRoll.characterBonus}
              characterBonusLabel={lastRoll.characterBonusLabel}
              buffBonus={lastRoll.buffBonus}
              buffBonusLabel={lastRoll.buffBonusLabel}
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
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black border ${ic.type === 'added' ? 'bg-amber-900/40 border-amber-700/50 text-amber-400' : ic.type === 'updated' ? 'bg-indigo-900/40 border-indigo-700/50 text-indigo-300' : 'bg-slate-800/60 border-slate-700/50 text-slate-400'}`}
                  >
                    <span>{ic.type === 'added' ? '＋' : ic.type === 'updated' ? '✦' : '－'}</span>
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
          <div onClick={e => e.stopPropagation()} className="bg-slate-900 border border-slate-700 rounded-[40px] p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-2xl">
            <Inventory
              party={session.party}
              activeCharacterId={session.activeCharacterId}
              onUseItem={(ownerCharId, itemId, targetCharId) => {
                submitAction('use item', 'none', 'easy', null, ownerCharId, itemId, targetCharId);
                setShowFullInventory(false);
              }}
              onUseItemInScene={(ownerCharId, itemId) => {
                void previewGearAction(ownerCharId, itemId);
              }}
              onImproveItemInScene={(ownerCharId, itemId, method) => {
                void previewImproveGearAction(ownerCharId, itemId, method);
              }}
              onGiveItem={(ownerCharId, itemId, targetCharId) => {
                submitAction('give item', 'none', 'easy', null, ownerCharId, itemId, targetCharId);
                setShowFullInventory(false);
              }}
              disabled={loading || previewThinking}
              previewThinking={previewThinking}
            />
          </div>
        </div>
      )}

      {gearActionPreview && (() => {
        const previewStat = gearActionPreview.stat;
        const base = activeChar?.stats[previewStat] ?? 0;
        const itemBonus = activeChar?.inventory.reduce((s, item) => s + (item.statBonuses?.[previewStat] ?? 0), 0) ?? 0;
        return (
          <FreeActionConfirmDialog
            preview={gearActionPreview}
            statBonus={base + itemBonus}
            submitting={gearPreviewSubmitting}
            onConfirm={() => {
              void confirmGearAction();
            }}
            onEdit={editGearAction}
            onCancel={() => setGearActionPreview(null)}
          />
        );
      })()}

      {/* Fullscreen image */}
      {fullscreenImage && <FullscreenImage url={fullscreenImage} onClose={() => setFullscreenImage(null)} />}

      {/* Fullscreen narration */}
      {fullscreenNarration && (
        <div
          className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950 animate-in fade-in cursor-zoom-out"
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-teal-950/90 p-8 animate-in fade-in">
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
          activeCharacter={activeChar}
          onClose={() => setSelectedCharacter(null)}
          onAvatarClick={url => {
            setSelectedCharacter(null);
            setFullscreenImage(url);
          }}
          previewThinking={previewThinking}
          onBlessCharacter={targetCharacterId => {
            void previewCharacterSupportAction(targetCharacterId, 'bless');
          }}
          onAidCharacter={targetCharacterId => {
            void previewCharacterSupportAction(targetCharacterId, 'aid');
          }}
        />
      )}
      <OnboardingOverlay step={tutorialStep} onAdvance={advanceTutorial} />

      {showKeybindingsHelp && (
        <KeybindingsHelp
          onClose={() => setShowKeybindingsHelp(false)}
          bindings={[
            { key: '1 / 2 / 3 / ...', action: 'Focus action choice (Enter submits)' },
            { key: 'next number', action: 'Focus custom action input' },
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
