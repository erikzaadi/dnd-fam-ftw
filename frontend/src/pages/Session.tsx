import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ActionAttempt, Character, HpChange, TurnResult } from '../types';
import { apiFetch, imgSrc } from '../lib/api';
import { useSessionRuntime } from '../session/useSessionRuntime';
import { playRollSfx } from '../session/sessionAudio';
import { PageLoader } from '../components/PageLoader';
import { CharacterPopup } from '../components/CharacterPopup';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FullscreenImage } from '../components/FullscreenImage';
import { Inventory } from '../components/game/Inventory';
import { SessionHud, GearPopover } from '../components/game/SessionHud';
import { StoryStage } from '../components/game/StoryStage';
import { ActionDock } from '../components/game/ActionDock';
import { FreeActionConfirmDialog } from '../components/game/FreeActionConfirmDialog';
import { DmDecisionRecapPanel } from '../components/game/DmDecisionRecapPanel';
import type { RollResult } from '../components/game/DmDecisionRecapPanel';
import { EncounterPanel } from '../components/game/EncounterPanel';
import { ChronicleDrawer } from '../components/game/ChronicleDrawer';
import { audioManager } from '../audio/audioManager';
import { useAudioSettings } from '../audio/useAudioSettings';
import { useTtsSettings } from '../tts/useTtsSettings';
import { narrationTtsService } from '../tts/narrationTtsService';
import { useCapabilities } from '../hooks/useCapabilities';
import { useKonamiCode } from '../hooks/useKonamiCode';
import { Tooltip } from '../components/Tooltip';
import { NarrationTtsButton } from '../components/NarrationTtsButton';
import { KeybindingsHelp } from '../components/KeybindingsHelp';
import { OnboardingOverlay } from '../components/OnboardingOverlay';
import { useOnboardingTutorial } from '../hooks/useOnboardingTutorial';
import { OriginView } from '../components/OriginView';
import { buildEncounterLookup, countEncounterTurns, getTurnEncounter } from '../lib/encounters';
import { devLog } from '../lib/devLog';
import type { DraftAttachment } from '../lib/previewAction';
import { AdventurePanel } from '../components/game/AdventurePanel';
import { AdventureEnding } from '../components/game/AdventureEnding';
import { findConclusionTurn, isAdventureCompleted, isAdventureConcluding, requestWrapUp, setAdventureFormat, setAutoIdeas } from '../session/adventureActions';
import { RealmUsageNotice } from '../components/game/RealmUsageNotice';

interface LastSubmittedAction {
  previewId?: string;
  choiceId?: number;
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

// How long the roll stays on screen, with its consequences, once the turn is committed.
const ROLL_REVEAL_MS = 600;

const toRollResult = (roll: NonNullable<ActionAttempt['actionResult']>, rollNarration: string | undefined, hpChanges: HpChange[] | undefined): RollResult => ({
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
  rollNarration,
  hpChanges,
});

const formatEncounterTurnSummary = (turn: TurnResult | null | undefined): string | undefined => {
  if (!turn) {
    return undefined;
  }
  const roll = turn.lastAction?.actionResult;
  if (roll && roll.statUsed !== 'none') {
    return `${roll.success ? 'Hit' : 'Miss'} ${roll.roll}`;
  }
  return 'Combat beat';
};

export const SessionPage = () => {
  const { settings, setMasterMuted } = useAudioSettings();
  const { settings: ttsSettings } = useTtsSettings();
  const { capabilities } = useCapabilities();
  const lastSpokenTurnIdRef = useRef<number | null>(null);
  const hasEarlyRollRef = useRef(false);
  const imageLoadingRef = useRef(false);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [viewedTurnIdx, setViewedTurnIdx] = useState(-1);
  const [customAction, setCustomAction] = useState("");
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [fullscreenNarration, setFullscreenNarration] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{message: string; confirmLabel?: string; onConfirm: () => void} | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [rollResult, setRollResult] = useState<RollResult | null>(null);
  const [interventionBanner, setInterventionBanner] = useState<string | null>(null);
  const [sanctuaryBanner, setSanctuaryBanner] = useState<string | null>(null);
  const [showFullInventory, setShowFullInventory] = useState(false);
  const [showChronicle, setShowChronicle] = useState(false);
  const [showKeybindingsHelp, setShowKeybindingsHelp] = useState(false);
  const [lastSubmittedAction, setLastSubmittedAction] = useState<LastSubmittedAction | null>(null);
  const [gearPreviewSubmitting, setGearPreviewSubmitting] = useState(false);
  const [currentTensionLevel, setCurrentTensionLevel] = useState<'low' | 'medium' | 'high' | null>(null);
  const [showBanner, setShowBanner] = useState(true);
  const [gearOpen, setGearOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [showOrigin, setShowOrigin] = useState(false);
  const [continuingWorld, setContinuingWorld] = useState(false);
  const [endingError, setEndingError] = useState<string | null>(null);
  const showBannerRef = useRef(showBanner);
  useEffect(() => {
    showBannerRef.current = showBanner;
  }, [showBanner]);
  const [storyFocusRequest, setStoryFocusRequest] = useState(0);
  const displayTurnRef = useRef<TurnResult | null>(null);
  const previewPartyBoostActionRef = useRef<() => void>(() => undefined);

  const requestStoryFocus = useCallback(() => {
    setStoryFocusRequest(version => version + 1);
  }, []);

  const submitTimeRef = useRef<number | null>(null);
  const timingEventsRef = useRef<Record<string, number>>({});

  const recordTimingEvent = useCallback((eventName: string) => {
    const now = Date.now();
    timingEventsRef.current[eventName] = now;

    if (eventName === 'submit') {
      submitTimeRef.current = now;
      timingEventsRef.current = { submit: now };
    } else if (submitTimeRef.current) {
      const elapsed = now - submitTimeRef.current;
      devLog.log(`[Timing] Event: ${eventName} elapsedMs=${elapsed}`);

      if (eventName === 'unlock') {
        const events = timingEventsRef.current;
        const submitToRoll = events.roll_ready ? events.roll_ready - events.submit : null;
        const submitToFirstNarration = events.first_chunk ? events.first_chunk - events.submit : null;
        const submitToStreamingDone = events.streaming_done ? events.streaming_done - events.submit : null;
        const submitToComplete = events.turn_complete ? events.turn_complete - events.submit : null;
        const submitToSubmittable = events.unlock ? events.unlock - events.submit : null;

        devLog.log(`[Timing] Submit-to-Submittable Breakdown:
- Submit to Roll Ready: ${submitToRoll !== null ? `${submitToRoll}ms` : 'n/a'}
- Submit to First Narration Chunk: ${submitToFirstNarration !== null ? `${submitToFirstNarration}ms` : 'n/a'}
- Submit to Narration Streaming Done: ${submitToStreamingDone !== null ? `${submitToStreamingDone}ms` : 'n/a'}
- Submit to Turn Complete (Persisted): ${submitToComplete !== null ? `${submitToComplete}ms` : 'n/a'}
- Submit to Submittable (UI Unlocked): ${submitToSubmittable !== null ? `${submitToSubmittable}ms` : 'n/a'}
        `);
        submitTimeRef.current = null;
      }
    }
  }, []);

  const clearPendingTurnUi = useCallback(() => {
    setLastSubmittedAction(null);
    setRollResult(null);
    hasEarlyRollRef.current = false;
  }, []);

  // Data, events, submission, previews and ideas come from the runtime shared with car
  // and terminal. This page only decides how turns are shown: the roll reveal,
  // banners, the viewed turn, the origin story and timing logs.
  const runtime = useSessionRuntime({
    sessionId: id!,
    onboardingIdeas: true,
    presenter: {
      onHistoryLoaded: (loaded, { initial, wasEmpty, latestChanged, session: loadedSession }) => {
        if (initial || latestChanged) {
          setViewedTurnIdx(loaded.length - 1);
        }
        if ((initial || wasEmpty) && loaded.length === 1) {
          setShowOrigin(true);
        }
        const latest = loaded[loaded.length - 1];
        if (initial && latest && !latest.imageUrl && !loadedSession.savingsMode) {
          setImageLoading(true);
        }
      },
      onTurnAppended: (_turn, index) => {
        setViewedTurnIdx(index);
      },
      onNarrating: ({ action, statUsed, difficulty, difficultyValue, character, ...preview }) => {
        if (action && statUsed && difficulty && character) {
          setLastSubmittedAction(prev => prev
            ? { ...prev, ...preview }
            : { label: action, stat: statUsed, difficulty, difficultyValue, char: character, ...preview });
        }
        recordTimingEvent('dm_narrating');
      },
      onNarrationChunk: (_text, field) => {
        if (field === 'narration' && !timingEventsRef.current['first_chunk']) {
          recordTimingEvent('first_chunk');
        }
      },
      onRollRevealed: (rollNarration, actionResult, hpChanges) => {
        recordTimingEvent('roll_ready');
        if (!actionResult || actionResult.statUsed === 'none') {
          return;
        }
        hasEarlyRollRef.current = true;
        setRollResult(toRollResult(actionResult, rollNarration ?? undefined, hpChanges));
        playRollSfx(actionResult);
      },
      onNarrationStreamingDone: () => {
        recordTimingEvent('streaming_done');
      },
      onNarrationChunkAbort: () => {
        // The roll stays on screen: only the narration is retrying.
        narrationTtsService.stopNarration();
      },
      onTurnComplete: (updatedSession, turnResult) => {
        recordTimingEvent('turn_complete');
        setContinuingWorld(false);
        setLastSubmittedAction(null);
        setCustomAction('');
        if (turnResult?.currentTensionLevel) {
          setCurrentTensionLevel(turnResult.currentTensionLevel);
        }
        const roll = turnResult?.lastAction?.actionResult;
        const rolled = !!turnResult && !!roll && roll.statUsed !== 'none';
        const turnEncounter = turnResult
          ? getTurnEncounter(turnResult, buildEncounterLookup(updatedSession?.encounterState, updatedSession?.pastEncounters))
          : null;
        const consequences: Partial<RollResult> = turnResult ? {
          hpChanges: turnResult.hpChanges,
          inventoryChanges: turnResult.inventoryChanges,
          encounterEnemyChanges: turnResult.encounterEnemyChanges,
          encounterId: turnResult.encounterId,
          encounterName: turnEncounter?.name,
          encounterStatus: turnEncounter?.status,
        } : {};
        // The roll stays on screen a moment with its consequences, then the story takes focus.
        const endReveal = () => {
          setTimeout(() => {
            setRollResult(null);
            requestStoryFocus();
            recordTimingEvent('unlock');
          }, ROLL_REVEAL_MS);
          return ROLL_REVEAL_MS;
        };
        if (hasEarlyRollRef.current) {
          hasEarlyRollRef.current = false;
          if (rolled) {
            setRollResult(prev => prev ? { ...prev, ...consequences } : prev);
          }
          return endReveal();
        }
        if (rolled && roll && turnResult) {
          setRollResult({ ...toRollResult(roll, turnResult.rollNarration, turnResult.hpChanges), ...consequences });
          playRollSfx(roll);
          return endReveal();
        }
        recordTimingEvent('unlock');
        if (turnResult) {
          requestStoryFocus();
        }
        return 0;
      },
      onFollowUpTurn: (kind, narration) => {
        if (kind === 'conclusion') {
          // Music settles for the ending; the tension effect follows this state.
          setCurrentTensionLevel('low');
          setContinuingWorld(false);
        } else if (kind === 'intervention') {
          setInterventionBanner(narration);
          setTimeout(() => setInterventionBanner(null), 8000);
        } else {
          setSanctuaryBanner(narration);
          setTimeout(() => setSanctuaryBanner(null), 10000);
        }
      },
      onTurnError: () => {
        clearPendingTurnUi();
        recordTimingEvent('unlock');
      },
      // Drafts live in separate state and are left untouched.
      onWaitEnded: () => {
        clearPendingTurnUi();
      },
      onImageReady: event => {
        if (event.target === 'scene') {
          setImageLoading(false);
        }
      },
    },
  });
  const {
    session,
    history,
    turnPhase,
    busy,
    actionError,
    setActionError,
    previewThinking,
    actionPreview,
    connectionState,
    revisionRef,
    updateSession,
    submitTurn,
    submitOperation,
    previewSceneAction,
    applyIdeas,
  } = runtime;
  // The dice are known and the DM is still narrating what they caused.
  const consequencesPending = turnPhase === 'revealing';

  const { step: tutorialStep, advance: advanceTutorial } = useOnboardingTutorial({
    isLoading: busy,
    lastRollVisible: !!rollResult,
  });

  useEffect(() => {
    if (history.length === 0) {
      return;
    }

    if (session?.encounterState?.status === 'active') {
      audioManager.setTension('high');
    } else {
      audioManager.setTension(currentTensionLevel || 'low');
    }
  }, [session?.encounterState?.status, currentTensionLevel, history.length]);

  useEffect(() => {
    if (busy) {
      audioManager.startNarrating();
    } else {
      audioManager.stopNarrating();
    }
  }, [busy]);

  // TTS: auto-speak the latest narration once per new turn (fires after story is visible).
  useEffect(() => {
    if (busy) {
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
    if (narrationTtsService.isNarrationSpeaking()) {
      return;
    }
    narrationTtsService.speakNarration({
      text: latestTurn.narration,
      settings: ttsSettings,
      hasTts: capabilities.hasTts,
      turnId: latestTurn.id,
      mainNarration: true,
    });
  }, [history, busy, ttsSettings, capabilities.hasTts]);

  // Stop TTS when leaving session
  useEffect(() => {
    return () => {
      narrationTtsService.stopNarration();
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // A more specific handler (e.g. party box bless/aid) already consumed this key
      if (e.defaultPrevented) {
        return;
      }
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
      } else if (e.key === 'p') {
        if (!showBannerRef.current) {
          setShowBanner(true);
          // Wait for render
          setTimeout(() => {
            const firstChar = document.querySelector('[data-tutorial="party-box"] button') as HTMLButtonElement;
            firstChar?.focus();
          }, 0);
        } else {
          const firstChar = document.querySelector('[data-tutorial="party-box"] button') as HTMLButtonElement;
          firstChar?.focus();
        }
      } else if (e.key === 'r') {
        previewPartyBoostActionRef.current();
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

  // Easter egg: the Konami code drops you into the retro adventure shell
  useKonamiCode(() => {
    audioManager.stopMusic();
    narrationTtsService.stopNarration();
    navigate(`/session/${id}/terminal`);
  });

  // Gear from the inventory joins the draft instead of acting at once: the player sees
  // it in the preview and confirms it like any other action. A typed draft is kept.
  const [draftAttachment, setDraftAttachment] = useState<DraftAttachment | null>(null);
  const attachGearToDraft = (actionType: DraftAttachment['actionType'], ownerCharId: string, itemId: string, targetCharId: string | null | undefined) => {
    const owner = session?.party.find(c => c.id === ownerCharId);
    const item = owner?.inventory.find(i => i.id === itemId);
    const target = targetCharId ? session?.party.find(c => c.id === targetCharId) : undefined;
    if (!owner || !item) {
      return;
    }
    const label = target && target.id !== owner.id ? `${item.name} → ${target.name}` : item.name;
    setDraftAttachment({ actionType, itemId, ownerCharacterId: ownerCharId, ...(target && { targetCharacterId: target.id }), label });
    if (!customAction.trim()) {
      setCustomAction(actionType === 'give_item' && target
        ? `${owner.name} gives ${item.name} to ${target.name}`
        : target && target.id !== owner.id
          ? `${owner.name} uses ${item.name} on ${target.name}`
          : `${owner.name} uses ${item.name}`);
    }
    setShowFullInventory(false);
  };

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
    updateSession({ savingsMode: enabled });
  };

  const submitAction = async (action: string, statUsed: string = 'none', difficulty: string = 'normal', difficultyValue: number | null = null, ownerCharId: string | null = null, itemId: string | null = null, targetCharId: string | null = null, preview: Partial<LastSubmittedAction> = {}, actionIntent?: string) => {
    if (!session) {
      return;
    }
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
    recordTimingEvent('submit');
    setMobileActionsOpen(false);
    audioManager.stopNarrating();
    narrationTtsService.stopNarration();
    const result = await submitTurn({
      action,
      statUsed,
      difficulty,
      difficultyValue,
      characterId: ownerCharId,
      itemId,
      targetCharacterId: targetCharId,
      actionIntent,
      previewId: preview.previewId,
      choiceId: preview.choiceId,
    });
    if (!result.ok) {
      // A 409 refreshes the snapshot in the runtime; the typed draft stays in the action box.
      setLastSubmittedAction(null);
    }
  };

  const previewGearAction = async (ownerCharId: string, itemId: string) => {
    if (!session || busy || previewThinking) {
      return;
    }

    const owner = session.party.find(c => c.id === ownerCharId);
    const item = owner?.inventory.find(i => i.id === itemId);
    if (!owner || !item || owner.id !== session.activeCharacterId) {
      return;
    }

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

  const previewImproveGearAction = async (ownerCharId: string, itemId: string, method: 'enchant' | 'craft' | 'tinker') => {
    if (!session || busy || previewThinking) {
      return;
    }
    const owner = session.party.find(c => c.id === ownerCharId);
    const item = owner?.inventory.find(i => i.id === itemId);
    const actor = session.party.find(c => c.id === session.activeCharacterId);
    if (!owner || !item || !actor || actor.status === 'downed') {
      return;
    }

    setShowFullInventory(false);
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
  };

  const previewCharacterSupportAction = async (targetCharacterId: string, kind: 'bless' | 'aid') => {
    if (!session || busy || previewThinking) {
      return;
    }
    const actor = session.party.find(c => c.id === session.activeCharacterId);
    const target = session.party.find(c => c.id === targetCharacterId);
    if (!actor || !target || actor.id === target.id || actor.status === 'downed' || target.status === 'downed') {
      return;
    }

    setSelectedCharacter(null);
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
  };

  const previewPartyBoostAction = async () => {
    if (!session || busy || previewThinking) {
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
    await previewSceneAction({ intent: 'party_boost' }, {
      characterBonus: 2,
      characterBonusLabel: strongest === 'magic' ? 'spotlight' : 'social edge',
      flavor: strongest === 'magic' ? 'spotlight' : 'social',
    }, `${actor.name} rallies the whole party with a short-lived boost`);
  };
  // The keyboard handler reads the latest version through this ref.
  useEffect(() => {
    previewPartyBoostActionRef.current = () => {
      void previewPartyBoostAction();
    };
  });

  // The keyboard handler (n / f) reads the shown turn and image state through refs.
  const shownTurn = history[viewedTurnIdx] ?? null;
  useEffect(() => {
    displayTurnRef.current = shownTurn;
    imageLoadingRef.current = imageLoading;
  }, [shownTurn, imageLoading]);

  const confirmGearAction = async () => {
    if (!actionPreview) {
      return;
    }
    setGearPreviewSubmitting(true);
    const preview: Partial<LastSubmittedAction> = {
      ...(actionPreview.previewId !== undefined && { previewId: actionPreview.previewId }),
      ...(actionPreview.helperBonus !== undefined && { helperBonus: actionPreview.helperBonus }),
      ...(actionPreview.helperCharacterName !== undefined && { helperCharacterName: actionPreview.helperCharacterName }),
      ...(actionPreview.choiceItemBonus !== undefined && { choiceItemBonus: actionPreview.choiceItemBonus }),
      ...(actionPreview.choiceItemName !== undefined && { choiceItemName: actionPreview.choiceItemName }),
      ...(actionPreview.choiceItemOwnerName !== undefined && { choiceItemOwnerName: actionPreview.choiceItemOwnerName }),
      ...(actionPreview.characterBonus !== undefined && { characterBonus: actionPreview.characterBonus }),
      ...(actionPreview.characterBonusLabel !== undefined && { characterBonusLabel: actionPreview.characterBonusLabel }),
      ...(actionPreview.flavor !== undefined && { flavor: actionPreview.flavor }),
    };
    const { interpretedAction, stat, difficulty, difficultyValue, pendingIntent, pendingTargetCharacterId } = actionPreview;
    runtime.clearPreview();
    setGearPreviewSubmitting(false);
    await submitAction(interpretedAction, stat, difficulty, difficultyValue ?? null, null, null, pendingTargetCharacterId ?? null, preview, pendingIntent);
  };

  const editGearAction = () => {
    if (!actionPreview) {
      return;
    }
    setCustomAction(actionPreview.interpretedAction);
    runtime.dismissPreview();
  };

  const handleWrapUp = async () => {
    if (!session) {
      return;
    }
    const result = await requestWrapUp(session.id, revisionRef.current);
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    updateSession(result.adventure ? { adventure: result.adventure } : {}, result.revision);
  };

  const handleToggleAutoIdeas = async () => {
    if (!session) {
      return;
    }
    const next = !session.autoIdeas;
    const result = await setAutoIdeas(session.id, next, revisionRef.current);
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    updateSession({ autoIdeas: next }, result.revision);
  };

  const handleToggleLongLived = async (longLived: boolean) => {
    if (!session) {
      return;
    }
    const result = await setAdventureFormat(session.id, longLived ? 'long_lived' : 'one_evening', revisionRef.current);
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    updateSession(result.adventure ? { adventure: result.adventure } : {}, result.revision);
  };

  const handleEndHere = () => {
    if (!session) {
      return;
    }
    setConfirmDialog({
      message: 'End tonight\'s adventure here? The DM will tell how things stand, without another roll.',
      confirmLabel: 'End here',
      onConfirm: () => {
        void (async () => {
          const message = await submitOperation('/adventure/end', {}, { expectsFollowUp: true });
          if (message) {
            setActionError(message);
          }
        })();
      },
    });
  };

  const handleContinueWorld = async (format: 'one_evening' | 'long_lived') => {
    if (!session) {
      return;
    }
    setEndingError(null);
    setContinuingWorld(true);
    // The new chapter's opening arrives via turn_complete.
    const message = await submitOperation('/adventure/continue', { adventureFormat: format });
    if (message) {
      setContinuingWorld(false);
      setEndingError(message);
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

  if (isAdventureCompleted(session) && !continuingWorld) {
    return (
      <AdventureEnding
        session={session}
        conclusion={findConclusionTurn(session, history)}
        continuing={continuingWorld}
        error={endingError}
        onContinue={format => {
          void handleContinueWorld(format);
        }}
        onViewChronicle={() => navigate(`/session/${session.id}/recap`)}
        onHome={() => {
          audioManager.stopMusic();
          narrationTtsService.stopNarration();
          navigate('/');
        }}
      />
    );
  }

  if (showOrigin) {
    return (
      <div className="h-screen overflow-hidden flex flex-col bg-slate-950 text-white">
        <OriginView sessionId={id!} session={session} onEnter={() => setShowOrigin(false)} hasTts={capabilities.hasTts} />
      </div>
    );
  }

  const displayTurn = shownTurn;
  // The action dock always acts on the latest turn: ideas belong to it, and choices of
  // an older turn can no longer be picked.
  const latestTurn = history[history.length - 1] ?? null;
  const stageFullscreenImageUrl = displayTurn?.imageUrl
    ? imgSrc(displayTurn.imageUrl)
    : (!imageLoading && !session.savingsMode ? imgSrc('/images/default_scene.png') : null);
  const activeChar = session.party.find(c => c.id === session.activeCharacterId) || null;
  const isDown = activeChar?.status === 'downed';

  const showNarrationOnlyLoading = busy;
  const showStoryOnlyMobile = !busy && !mobileActionsOpen && tutorialStep !== 3;
  const showMobileActionsOverlay = !busy && (mobileActionsOpen || tutorialStep === 3);
  const sessionGridRows = showNarrationOnlyLoading
    ? 'grid-rows-[minmax(0,1fr)]'
    : showStoryOnlyMobile
      ? 'grid-rows-[minmax(0,1fr)]'
      : 'grid-rows-[minmax(0,2fr)_minmax(0,3fr)]';
  const showInlineActionPanel = busy;
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
          onBlessCharacter={targetCharacterId => {
            void previewCharacterSupportAction(targetCharacterId, 'bless');
          }}
          onAidCharacter={targetCharacterId => {
            void previewCharacterSupportAction(targetCharacterId, 'aid');
          }}
          previewThinking={previewThinking}
        />
      )}

      <RealmUsageNotice refreshKey={history.length} />

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
            autoIdeas={!!session.autoIdeas}
            onToggleAutoIdeas={() => {
              void handleToggleAutoIdeas();
            }}
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
          <Tooltip content="Car Mode" position="bottom" align="right" portal>
            <button
              onClick={() => navigate(`/session/${session.id}/car`)}
              className="w-11 h-11 flex items-center justify-center rounded-xl border border-slate-700 text-slate-400 hover:bg-slate-800 hover:border-slate-500 hover:text-slate-200 text-lg transition-all"
              aria-label="Car Mode"
            >
              🚗
            </button>
          </Tooltip>
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
            activeEncounter={session.encounterState}
            pastEncounters={session.pastEncounters}
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
            {session.adventure && session.adventure.status === 'active' && (
              <AdventurePanel
                adventure={session.adventure}
                disabled={busy || previewThinking}
                onWrapUp={() => {
                  void handleWrapUp();
                }}
                onEndHere={handleEndHere}
                onToggleLongLived={longLived => {
                  void handleToggleLongLived(longLived);
                }}
              />
            )}
            {isAdventureConcluding(session) && !busy && (
              <button
                type="button"
                onClick={handleEndHere}
                className="rounded-2xl bg-amber-600 py-3 text-sm font-black uppercase tracking-widest text-slate-950 hover:bg-amber-500"
              >
                  Finish the story
              </button>
            )}
            {session.encounterState?.status === 'active' && (
              <EncounterPanel
                encounter={session.encounterState}
                highlighted={rollResult?.encounterId === session.encounterState.id}
                latestTurnSummary={formatEncounterTurnSummary([...history].reverse().find(t => t.encounterId === session.encounterState?.id))}
                turnCount={countEncounterTurns(history, session.encounterState.id)}
              />
            )}
            <div className="min-h-0 flex-1">
              <ActionDock
                turn={latestTurn}
                loading={busy || previewThinking}
                previewThinking={previewThinking}
                activeCharacter={activeChar}
                isDown={isDown}
                party={session.party}
                sessionId={session.id}
                customAction={customAction}
                setCustomAction={setCustomAction}
                revision={session.revision}
                error={actionError}
                onSubmit={submitAction}
                onShowPartyGear={() => setShowFullInventory(true)}
                onCharacterClick={setSelectedCharacter}
                onIdeas={applyIdeas}
                attachment={draftAttachment}
                onClearAttachment={() => setDraftAttachment(null)}
                onBless={targetCharacterId => {
                  void previewCharacterSupportAction(targetCharacterId, 'bless');
                }}
                onAid={targetCharacterId => {
                  void previewCharacterSupportAction(targetCharacterId, 'aid');
                }}
                onRally={() => {
                  void previewPartyBoostAction();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {!showChronicle && !busy && !showMobileActionsOverlay && (
        <nav className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[80] grid grid-cols-3 gap-2 rounded-2xl border border-slate-700/80 bg-slate-950/92 p-2 shadow-2xl backdrop-blur-md xl:hidden" aria-label="Session mobile tools">
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

      <div className={`grid gap-4 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] min-h-dvh grid-cols-1 ${sessionGridRows} xl:h-dvh xl:overflow-hidden xl:grid-cols-[minmax(0,1fr)_520px] xl:grid-rows-[1fr] xl:pb-4 ${showBanner ? 'pt-40 sm:pt-28' : 'pt-14 xl:pt-3'}`}>
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
          {busy ? (
            <DmDecisionRecapPanel lastSubmittedAction={lastSubmittedAction} ttsSettings={ttsSettings} rollResult={rollResult} consequencesPending={consequencesPending} />
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-2">
              {session.adventure && session.adventure.status === 'active' && (
                <AdventurePanel
                  adventure={session.adventure}
                  disabled={busy || previewThinking}
                  onWrapUp={() => {
                    void handleWrapUp();
                  }}
                  onEndHere={handleEndHere}
                  onToggleLongLived={longLived => {
                    void handleToggleLongLived(longLived);
                  }}
                />
              )}
              {isAdventureConcluding(session) && !busy && (
                <button
                  type="button"
                  onClick={handleEndHere}
                  className="rounded-2xl bg-amber-600 py-3 text-sm font-black uppercase tracking-widest text-slate-950 hover:bg-amber-500"
                >
                  Finish the story
                </button>
              )}
              {session.encounterState?.status === 'active' && (
                <EncounterPanel
                  encounter={session.encounterState}
                  highlighted={rollResult?.encounterId === session.encounterState.id}
                  latestTurnSummary={formatEncounterTurnSummary([...history].reverse().find(t => t.encounterId === session.encounterState?.id))}
                  turnCount={countEncounterTurns(history, session.encounterState.id)}
                />
              )}
              <div className="min-h-0 flex-1">
                <ActionDock
                  turn={latestTurn}
                  loading={busy || previewThinking}
                  previewThinking={previewThinking}
                  activeCharacter={activeChar}
                  isDown={isDown}
                  party={session.party}
                  sessionId={session.id}
                  customAction={customAction}
                  setCustomAction={setCustomAction}
                  revision={session.revision}
                  error={actionError}
                  onSubmit={submitAction}
                  onShowPartyGear={() => setShowFullInventory(true)}
                  onCharacterClick={setSelectedCharacter}
                  onIdeas={applyIdeas}
                  attachment={draftAttachment}
                  onClearAttachment={() => setDraftAttachment(null)}
                  onBless={targetCharacterId => {
                    void previewCharacterSupportAction(targetCharacterId, 'bless');
                  }}
                  onAid={targetCharacterId => {
                    void previewCharacterSupportAction(targetCharacterId, 'aid');
                  }}
                  onRally={() => {
                    void previewPartyBoostAction();
                  }}
                />
              </div>
            </div>
          )}
        </div>

      </div>

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
                attachGearToDraft('use_item', ownerCharId, itemId, targetCharId);
              }}
              onUseItemInScene={(ownerCharId, itemId) => {
                void previewGearAction(ownerCharId, itemId);
              }}
              onImproveItemInScene={(ownerCharId, itemId, method) => {
                void previewImproveGearAction(ownerCharId, itemId, method);
              }}
              onGiveItem={(ownerCharId, itemId, targetCharId) => {
                attachGearToDraft('give_item', ownerCharId, itemId, targetCharId);
              }}
              disabled={busy || previewThinking}
              previewThinking={previewThinking}
            />
          </div>
        </div>
      )}

      {actionPreview && (() => {
        const previewStat = actionPreview.stat;
        const base = activeChar?.stats[previewStat] ?? 0;
        const itemBonus = activeChar?.inventory.reduce((s, item) => s + (item.statBonuses?.[previewStat] ?? 0), 0) ?? 0;
        return (
          <FreeActionConfirmDialog
            preview={actionPreview}
            statBonus={base + itemBonus}
            submitting={gearPreviewSubmitting}
            onConfirm={() => {
              void confirmGearAction();
            }}
            onEdit={editGearAction}
            onCancel={runtime.dismissPreview}
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
            { key: 'u', action: 'Unleash the typed action' },
            { key: 'g', action: 'Give me ideas' },
            { key: 'd', action: 'Ask the DM (the typed question, without taking a turn)' },
            { key: 'o', action: 'Help someone (open / close)' },
            { key: 'Esc / z', action: 'Undo an action that is about to be sent' },
            { key: 'v', action: 'Start voice action' },
            { key: 'i', action: 'Open inventory' },
            { key: 'n', action: 'Toggle fullscreen narration' },
            { key: 'f', action: 'Toggle fullscreen image' },
            { key: 'c', action: 'Open / close Chronicle' },
            { key: '← ↓ / h j = older · → ↑ / l k = newer', action: 'Navigate turns (Chronicle open)' },
            { key: 'Enter', action: 'Expand turn detail (Chronicle open)' },
            { key: 's', action: 'Open / close settings' },
            { key: 'q', action: 'Exit realm (with confirm)' },
            { key: 'p', action: 'Focus party box (shows banner)' },
            { key: 'e / a', action: 'Bless / Aid hovered or focused party member' },
            { key: 'r', action: 'Party rally (boon)' },
            { key: 'b', action: 'Toggle banner' },
            { key: 'Esc', action: 'Close overlays / blur input' },
            { key: '?', action: 'Toggle this help' },
          ]}
        />
      )}
    </div>
  );
};
