import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { TurnResult, Character, FreeActionPreview, IdeasPayload, AskDmPayload } from '../../types';
import { imgSrc, pulseSyncDelay } from '../../lib/api';
import { currentIdeas, fetchIdeas } from '../../lib/ideas';
import { askDm } from '../../lib/askDm';
import { requestActionPreview, type ClarificationThread, type DraftAttachment } from '../../lib/previewAction';
import { computeChoiceOdds, COMBO_HELPER_BONUS, CHOICE_ITEM_BONUS, CHARACTER_EDGE_BONUS } from '../../lib/game';
import { StatImg } from './StatIcon';
import { STAT_COLORS, STAT_TEXT_COLORS } from '../../lib/statColors';
import { getHpColors } from '../../lib/hpColors';
import { useTtsSettings } from '../../tts/useTtsSettings';
import { browserTtsService } from '../../tts/browserTtsService';
import { narrationTtsService } from '../../tts/narrationTtsService';
import { useSttSettings } from '../../stt/useSttSettings';
import { useSpeechRecognition } from '../../stt/useSpeechRecognition';
import { parseSpeechIntent } from '../../stt/speechIntent';
import { SpeechActionButton } from './SpeechActionButton';
import { SpeechConfirmDialog } from './SpeechConfirmDialog';
import { FreeActionConfirmDialog } from './FreeActionConfirmDialog';
import { Tooltip } from '../Tooltip';
import { HelpSomeone } from './HelpSomeone';
import { formatCharacterBonusLabel, formatChoiceItemBonusLabel, formatHelperBonusLabel } from './rollBonusLabels';
interface ActionDockProps {
  turn: TurnResult | null;
  loading: boolean;
  previewThinking?: boolean;
  activeCharacter: Character | null;
  isDown: boolean | undefined;
  party: Character[];
  sessionId: string;
  customAction: string;
  setCustomAction: (v: string) => void;
  error: string | null;
  onSubmit: (label: string, stat: string, diff: string, difficultyValue?: number, ownerCharId?: string | null, itemId?: string | null, targetCharId?: string | null, preview?: ActionPreviewBonuses) => Promise<void> | void;
  onShowPartyGear: () => void;
  onCharacterClick?: (char: Character) => void;
  // Session revision; a change invalidates any open preview computed against the old state.
  revision?: number;
  // Ideas generated on request for the latest turn (the parent stores them on the turn).
  onIdeas?: (payload: IdeasPayload) => void;
  // Gear attached to the draft from the inventory; sent with the preview.
  attachment?: DraftAttachment | null;
  onClearAttachment?: () => void;
  // How long a clean typed action waits for Undo before it is sent (tests shorten it).
  autoSendDelayMs?: number;
  // "Help someone": support actions, each through the usual preview.
  onBless?: (targetCharacterId: string) => void;
  onAid?: (targetCharacterId: string) => void;
  onRally?: () => void;
}

interface ActionPreviewBonuses {
  // Server handle for a confirmed free-action preview; the server re-derives mechanics from it.
  previewId?: string;
  // Stable id of the suggested choice; the server resolves mechanics from its stored descriptor.
  choiceId?: number;
  helperBonus?: number;
  helperCharacterName?: string;
  choiceItemBonus?: number;
  choiceItemName?: string;
  choiceItemOwnerName?: string;
  characterBonus?: number;
  characterBonusLabel?: string;
  flavor?: string;
}

const RISK_MAP: Record<string, { label: string; color: string }> = {
  easy: { label: 'Favorable', color: 'text-emerald-400' },
  normal: { label: 'Risky', color: 'text-amber-400' },
  hard: { label: 'Tough', color: 'text-rose-400' },
};

const SHOW_NUMBERS_STORAGE_KEY = 'dnd-fam-ftw:action-dock:show-numbers';

const ACTION_INPUT_ID = 'action-dock-input';
const CLARIFICATION_ID = 'action-dock-dm-question';

// Placeholder examples that invite players to try anything, rotated per turn.
const ACTION_EXAMPLES = [
  'e.g. I swing from the chandelier',
  'e.g. I offer the guard a sandwich',
  'e.g. I use my rope to help the wizard cross',
  'e.g. I tickle the troll with a feather',
  'e.g. I sing a lullaby to the dragon',
];

// Per-viewer preference; storage can be unavailable (private mode), so default quietly.
const ALWAYS_CONFIRM_STORAGE_KEY = 'dnd-fam-ftw:action-dock:always-confirm';
const AUTO_SEND_DELAY_MS = 3000;

// Per viewer: "Ask before sending" shows the confirm dialog for every typed action.
const loadAlwaysConfirm = (): boolean => {
  try {
    return window.localStorage.getItem(ALWAYS_CONFIRM_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

const saveAlwaysConfirm = (value: boolean): void => {
  try {
    window.localStorage.setItem(ALWAYS_CONFIRM_STORAGE_KEY, String(value));
  } catch {
    // Preference just won't persist.
  }
};

// The confirm dialog is for previews worth a second look: warnings (claimed outcomes,
// missing items, riddle answers, a failed preview), gear, and dictated text, which can
// be misheard. A clean typed action is sent after a short Undo window instead.
const needsConfirmation = (preview: FreeActionPreview, spoken: boolean, alwaysConfirm: boolean): boolean =>
  alwaysConfirm || spoken || preview.warnings.length > 0 || !!preview.itemAction;

// Numbers (target, odds) are shown unless this viewer hid them.
const loadShowNumbers = (): boolean => {
  try {
    return window.localStorage.getItem(SHOW_NUMBERS_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
};

const saveShowNumbers = (value: boolean): void => {
  try {
    window.localStorage.setItem(SHOW_NUMBERS_STORAGE_KEY, String(value));
  } catch {
    // Preference just won't persist.
  }
};

const CHOICE_FLAVOR_BADGES: Record<string, { label: string; className: string }> = {
  spotlight: { label: 'Spotlight', className: 'bg-fuchsia-950/40 border-fuchsia-700/50 text-fuchsia-300' },
  combo: { label: 'Team Up', className: 'bg-cyan-950/40 border-cyan-700/50 text-cyan-300' },
  social: { label: 'Social', className: 'bg-violet-950/40 border-violet-700/50 text-violet-300' },
  item: { label: 'Gear', className: 'bg-amber-950/40 border-amber-700/50 text-amber-300' },
  environment: { label: 'Obstacle', className: 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300' },
};

// Key hint in the corner of a control, matching the numbered choice badges.
const ShortcutBadge = ({ keyLabel, description }: { keyLabel: string; description: string }) => (
  <div className="absolute -top-2.5 -left-2.5 z-20 hidden md:block">
    <Tooltip content={`${description} [${keyLabel}]`} position="bottom" portal wrapperClassName="inline-flex">
      <span className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-400">
        {keyLabel}
      </span>
    </Tooltip>
  </div>
);

export const ActionDock = ({
  turn,
  loading,
  previewThinking = false,
  activeCharacter,
  isDown,
  party,
  sessionId,
  customAction,
  setCustomAction,
  error,
  onSubmit,
  onShowPartyGear,
  onCharacterClick,
  revision,
  onIdeas,
  attachment = null,
  onClearAttachment,
  autoSendDelayMs = AUTO_SEND_DELAY_MS,
  onBless,
  onAid,
  onRally,
}: ActionDockProps) => {
  const [statThinking, setStatThinking] = useState(false);
  const [expandedStat, setExpandedStat] = useState<string | null>(null);
  const [freeActionPreview, setFreeActionPreview] = useState<FreeActionPreview | null>(null);
  // Family-first: the story, the hero and a plain risk word lead; roll targets, stacked
  // bonuses and odds are one tap away for players who want the arithmetic.
  const [showNumbers, setShowNumbers] = useState(loadShowNumbers);
  const toggleShowNumbers = useCallback(() => {
    setShowNumbers(prev => {
      saveShowNumbers(!prev);
      return !prev;
    });
  }, []);
  const [alwaysConfirm, setAlwaysConfirm] = useState(loadAlwaysConfirm);
  const toggleAlwaysConfirm = useCallback(() => {
    setAlwaysConfirm(prev => {
      saveAlwaysConfirm(!prev);
      return !prev;
    });
  }, []);
  // A clean typed action waiting out its Undo window before it is sent.
  const [pendingSend, setPendingSend] = useState<FreeActionPreview | null>(null);
  const [previewRevision, setPreviewRevision] = useState(revision);
  // The story moved on while a preview was open: close it. The typed draft is kept
  // in the action box, so the player can re-preview against the current scene.
  if (previewRevision !== revision) {
    setPreviewRevision(revision);
    setFreeActionPreview(null);
    setPendingSend(null);
  }
  const [previewSubmitting, setPreviewSubmitting] = useState(false);
  // An open DM question about the draft. While set, the text box holds the reply.
  const [clarification, setClarification] = useState<ClarificationThread | null>(null);
  // A retryable explanation from the preview (e.g. "try describing it another way").
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);
  // "Give me ideas": on-request suggestions for the latest turn.
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const [ideasTurnId, setIdeasTurnId] = useState(turn?.id);
  // "Ask the DM": a question answered without taking a turn. An answer only shows while
  // its turn and revision are current.
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  // Tapping "Ask the DM" with an empty box explains where the question goes.
  const [askHint, setAskHint] = useState(false);
  // "Help someone" panel, also opened with the o shortcut (which focuses its first option).
  const [helpOpen, setHelpOpen] = useState(false);
  const helpFocusPendingRef = useRef(false);
  const helpRef = useRef<HTMLDivElement>(null);
  const [dmAnswer, setDmAnswer] = useState<AskDmPayload | null>(null);
  if (ideasTurnId !== turn?.id) {
    setIdeasTurnId(turn?.id);
    setIdeasLoading(false);
    setIdeasError(null);
    setAskError(null);
  }
  const choiceButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { settings: ttsSettings } = useTtsSettings();
  const { settings: sttSettings } = useSttSettings();
  const ttsEnabled = ttsSettings.enabled && browserTtsService.isSupported();

  // Only ideas that are current for this revision and hero: stale ones are hidden.
  const choices = useMemo(
    () => currentIdeas(turn, { revision, activeCharacterId: activeCharacter?.id }),
    [turn, revision, activeCharacter?.id],
  );
  const customActionShortcut = choices.length + 1;

  const submitSuggestedChoice = useCallback(async (index: number) => {
    const choice = choices[index];
    if (!choice || loading) {
      return;
    }
    const hasActiveHelper = choice.flavor === 'combo' && !!choice.helperCharacterName && party.some(c => c.name === choice.helperCharacterName && c.status === 'active' && c.id !== activeCharacter?.id);
    const choiceItemOwner = choice.flavor === 'item' && choice.itemOwnerName === activeCharacter?.name
      ? party.find(c => c.name === choice.itemOwnerName && c.status === 'active')
      : null;
    const choiceItem = choiceItemOwner && choice.itemName
      ? choiceItemOwner.inventory.find(item => item.name === choice.itemName)
      : null;
    const preview: ActionPreviewBonuses = {
      ...(choice.id !== undefined && { choiceId: choice.id }),
      ...(hasActiveHelper && { helperBonus: COMBO_HELPER_BONUS, helperCharacterName: choice.helperCharacterName }),
      ...(choiceItem && choiceItemOwner && { choiceItemBonus: CHOICE_ITEM_BONUS, choiceItemName: choiceItem.name, choiceItemOwnerName: choiceItemOwner.name }),
      ...(choice.flavor === 'spotlight' && { characterBonus: CHARACTER_EDGE_BONUS, characterBonusLabel: 'spotlight', flavor: 'spotlight' }),
      ...(choice.flavor === 'social' && { characterBonus: CHARACTER_EDGE_BONUS, characterBonusLabel: 'social edge', flavor: 'social' }),
    };
    await onSubmit(choice.label, choice.stat, choice.difficulty, choice.difficultyValue, undefined, undefined, undefined, preview);
  }, [activeCharacter, choices, loading, onSubmit, party]);

  const submitCustomText = useCallback(async (actionText: string, spoken = false) => {
    const trimmed = actionText.trim();
    if (!trimmed || loading || pendingSend) {
      return;
    }
    setStatThinking(true);
    setPreviewNotice(null);
    const result = await requestActionPreview(sessionId, trimmed, clarification, attachment);
    setStatThinking(false);
    if (result.kind === 'clarification') {
      // The box now takes the reply; the draft stays visible above it.
      setClarification(result.thread);
      setCustomAction('');
      return;
    }
    if (clarification) {
      // The exchange is over either way: the draft goes back in the box.
      setClarification(null);
      setCustomAction(clarification.originalDraft);
    }
    if (result.kind === 'error') {
      setPreviewNotice(result.message);
      return;
    }
    const draft = result.originalDraft;
    let preview: FreeActionPreview = {
      originalAction: draft,
      interpretedAction: draft,
      stat: 'mischief',
      difficulty: 'normal',
      warnings: [],
    };
    if (result.kind === 'preview') {
      preview = {
        ...preview,
        ...result.preview,
        originalAction: draft,
        interpretedAction: result.preview.interpretedAction ?? draft,
        difficulty: result.preview.difficulty ?? preview.difficulty,
        warnings: result.preview.warnings ?? [],
      };
    } else {
      preview = {
        ...preview,
        warnings: ['Preview failed - submitting with default stat. You can still confirm or cancel.'],
      };
    }
    if (needsConfirmation(preview, spoken, alwaysConfirm)) {
      setFreeActionPreview(preview);
    } else {
      setPendingSend(preview);
    }
  }, [alwaysConfirm, attachment, clarification, loading, pendingSend, sessionId, setCustomAction]);

  const latestTurnId = turn?.id;
  const askForIdeas = useCallback(async (retry: boolean) => {
    if (latestTurnId === undefined) {
      return;
    }
    setIdeasLoading(true);
    setIdeasError(null);
    const result = await fetchIdeas(sessionId, { turnId: latestTurnId, revision: revision ?? 0, ...(retry && { retry: true }) });
    setIdeasLoading(false);
    if (result.kind === 'ideas') {
      onIdeas?.(result.payload);
    } else {
      setIdeasError(result.message);
    }
  }, [latestTurnId, onIdeas, revision, sessionId]);

  const askTheDm = useCallback(async (spokenQuestion?: string) => {
    const question = (spokenQuestion ?? customAction).trim();
    if (!question || latestTurnId === undefined) {
      return;
    }
    setAskLoading(true);
    setAskError(null);
    const result = await askDm(sessionId, { question, turnId: latestTurnId, revision: revision ?? 0 });
    setAskLoading(false);
    if (result.kind === 'answer') {
      setDmAnswer(result.payload);
      // It was a question, not an action: the box is free for what they try next.
      if (spokenQuestion === undefined) {
        setCustomAction('');
      }
    } else {
      setAskError(result.message);
    }
  }, [customAction, latestTurnId, revision, sessionId, setCustomAction]);
  // Ask the DM from the button or the d shortcut. With an empty box, point to it instead.
  const requestAsk = useCallback(() => {
    if (!customAction.trim()) {
      setAskHint(true);
      textareaRef.current?.focus();
      return;
    }
    setAskHint(false);
    void askTheDm();
  }, [askTheDm, customAction]);

  useEffect(() => {
    if (helpOpen && helpFocusPendingRef.current) {
      helpFocusPendingRef.current = false;
      helpRef.current?.querySelector<HTMLButtonElement>('[role="group"] button:not(:disabled)')?.focus();
    }
  }, [helpOpen]);

  const visibleAnswer = dmAnswer && dmAnswer.turnId === turn?.id && dmAnswer.revision === (revision ?? 0) ? dmAnswer : null;

  const startOverClarification = useCallback(() => {
    if (!clarification) {
      return;
    }
    setCustomAction(clarification.originalDraft);
    setClarification(null);
    textareaRef.current?.focus();
  }, [clarification, setCustomAction]);

  // When the DM asks, the answer box takes focus and the question scrolls into view
  // (on phones the keyboard would otherwise cover it).
  const clarificationQuestion = clarification?.question;
  const clarificationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!clarificationQuestion) {
      return;
    }
    textareaRef.current?.focus();
    clarificationRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [clarificationQuestion]);

  // Sends a previewed action: the server resolves it from the stored preview.
  const sendPreview = useCallback(async (sent: FreeActionPreview, useOriginalAction: boolean) => {
    const preview: ActionPreviewBonuses = {
      ...(sent.previewId !== undefined && { previewId: sent.previewId }),
      ...(sent.helperBonus !== undefined && { helperBonus: sent.helperBonus }),
      ...(sent.helperCharacterName !== undefined && { helperCharacterName: sent.helperCharacterName }),
      ...(sent.choiceItemBonus !== undefined && { choiceItemBonus: sent.choiceItemBonus }),
      ...(sent.choiceItemName !== undefined && { choiceItemName: sent.choiceItemName }),
      ...(sent.choiceItemOwnerName !== undefined && { choiceItemOwnerName: sent.choiceItemOwnerName }),
      ...(sent.characterBonus !== undefined && { characterBonus: sent.characterBonus }),
      ...(sent.characterBonusLabel !== undefined && { characterBonusLabel: sent.characterBonusLabel }),
      ...(sent.flavor !== undefined && { flavor: sent.flavor }),
    };
    const { interpretedAction, originalAction, stat, difficulty, difficultyValue, itemAction } = sent;
    const submittedAction = useOriginalAction ? originalAction : interpretedAction;
    if (itemAction) {
      // The item is on its way into the turn; the chip is done.
      onClearAttachment?.();
    }
    // Gear resolves without a roll: the server takes the item action from the preview.
    await onSubmit(submittedAction, itemAction ? 'none' : stat, difficulty, difficultyValue, undefined, undefined, undefined, preview);
  }, [onClearAttachment, onSubmit]);

  const confirmFreeAction = useCallback(async (useOriginalAction: boolean = false) => {
    if (!freeActionPreview) {
      return;
    }
    setPreviewSubmitting(true);
    const sent = freeActionPreview;
    setFreeActionPreview(null);
    setPreviewSubmitting(false);
    await sendPreview(sent, useOriginalAction);
  }, [freeActionPreview, sendPreview]);

  // The Undo window: the action goes out unless the player takes it back. The latest
  // sendPreview is read through a ref, so parent re-renders do not restart the timer.
  const sendPreviewRef = useRef(sendPreview);
  useEffect(() => {
    sendPreviewRef.current = sendPreview;
  }, [sendPreview]);
  useEffect(() => {
    if (!pendingSend) {
      return;
    }
    const timer = window.setTimeout(() => {
      setPendingSend(null);
      void sendPreviewRef.current(pendingSend, false);
    }, autoSendDelayMs);
    return () => window.clearTimeout(timer);
  }, [autoSendDelayMs, pendingSend]);

  const editFreeAction = useCallback(() => {
    if (!freeActionPreview) {
      return;
    }
    setCustomAction(freeActionPreview.originalAction);
    setFreeActionPreview(null);
  }, [freeActionPreview, setCustomAction]);

  const cancelFreeAction = useCallback(() => {
    setFreeActionPreview(null);
  }, []);

  const confirmSpeechTranscript = useCallback(async (transcript: string) => {
    // A spoken reply to an open DM question goes with its draft, not as a new action.
    if (clarification) {
      const reply = transcript.trim();
      setCustomAction(reply);
      await submitCustomText(reply, true);
      return;
    }
    const intent = parseSpeechIntent(transcript);
    if (intent.type === 'choice' && choices[intent.index]) {
      await submitSuggestedChoice(intent.index);
      return;
    }
    // Session-management phrases are not adventure actions; the Story controls handle them.
    if (intent.type === 'wrap-up' || intent.type === 'end-here') {
      return;
    }
    // "Give me ideas" / "options" asks for ideas instead of becoming an action.
    if (intent.type === 'options') {
      await askForIdeas(false);
      return;
    }
    // "Ask the DM ..." is a question, not an action.
    if (intent.type === 'ask') {
      await askTheDm(intent.question);
      return;
    }

    // Dictated actions always get the confirm dialog: speech can be misheard.
    const text = intent.type === 'custom' ? intent.text : transcript.trim();
    setCustomAction(text);
    await submitCustomText(text, true);
  }, [askForIdeas, askTheDm, choices, clarification, setCustomAction, submitCustomText, submitSuggestedChoice]);

  const speech = useSpeechRecognition({
    onConfirmTranscript: confirmSpeechTranscript,
  });

  const speechIntent = useMemo(() => {
    if (speech.state.status !== 'confirming' && speech.state.status !== 'submitting') {
      return null;
    }
    return parseSpeechIntent(speech.state.transcript);
  }, [speech.state]);

  const speechActive = speech.state.status === 'listening' || speech.state.status === 'processing';
  const speechBusy = speechActive || speech.state.status === 'confirming' || speech.state.status === 'submitting';
  const canInteractSpeech = sttSettings.enabled && speech.isSupported && !loading && !statThinking && !isDown;
  const canStartSpeech = canInteractSpeech && !speechBusy;
  const speechButtonDisabled = !canInteractSpeech || speech.state.status === 'confirming' || speech.state.status === 'submitting';
  const toggleSpeech = useCallback(() => {
    if (speechActive) {
      speech.cancel();
      return;
    }
    if (!canStartSpeech) {
      return;
    }
    narrationTtsService.stopNarration();
    void speech.startListening();
  }, [speechActive, canStartSpeech, speech]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inTextField = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT';

      // Undo works from the text box too: that is where the player just pressed Enter.
      if (pendingSend && (e.key === 'Escape' || (!inTextField && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        setPendingSend(null);
        return;
      }

      if (inTextField) {
        // An Escape the box already handled (e.g. starting over on a DM question) keeps focus.
        if (e.key === 'Escape' && !e.defaultPrevented) {
          target.blur();
        }
        return;
      }

      if (loading || isDown) {
        return;
      }

      const shortcutIndex = Number(e.key) - 1;
      if (Number.isInteger(shortcutIndex) && shortcutIndex >= 0 && shortcutIndex < choices.length) {
        e.preventDefault();
        choiceButtonRefs.current[shortcutIndex]?.focus();
      } else if (e.key === String(customActionShortcut)) {
        e.preventDefault();
        textareaRef.current?.focus();
      } else if (e.key === 'i') {
        onShowPartyGear();
      } else if (e.key.toLowerCase() === 'v') {
        e.preventDefault();
        toggleSpeech();
      } else if (e.key.toLowerCase() === 'u') {
        if (customAction.trim() && !pendingSend && !statThinking && !previewThinking) {
          e.preventDefault();
          void submitCustomText(customAction);
        }
      } else if (e.key.toLowerCase() === 'g') {
        if (choices.length === 0 && latestTurnId !== undefined && !ideasLoading) {
          e.preventDefault();
          void askForIdeas(false);
        }
      } else if (e.key.toLowerCase() === 'd') {
        if (!clarification && !askLoading && !pendingSend && !statThinking && !previewThinking && latestTurnId !== undefined) {
          e.preventDefault();
          requestAsk();
        }
      } else if (e.key.toLowerCase() === 'o') {
        if (!pendingSend && !statThinking && !previewThinking) {
          e.preventDefault();
          helpFocusPendingRef.current = !helpOpen;
          setHelpOpen(!helpOpen);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [askForIdeas, askLoading, choices, clarification, customAction, customActionShortcut, helpOpen, ideasLoading, latestTurnId, loading, isDown, onShowPartyGear, pendingSend, previewThinking, requestAsk, statThinking, submitCustomText, toggleSpeech]);

  const submitCustom = async () => {
    await submitCustomText(customAction);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-[32px] border border-slate-800 overflow-y-auto scrollbar-hide">

      {/* Error + character header */}
      <div className="flex flex-col gap-3 p-4">
        {error && (
          <div className="px-4 py-2 bg-rose-950/60 border border-rose-700 rounded-xl text-rose-300 text-xs font-semibold">
            {error}
          </div>
        )}

        {/* Active hero panel */}
        {activeCharacter && (
          <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-2xl border border-slate-700/50">
            {activeCharacter.avatarUrl ? (
              <img
                src={imgSrc(activeCharacter.avatarUrl)}
                className="w-20 h-20 rounded-2xl object-cover border-2 border-amber-500 animate-border-pulse shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                style={{ animationDelay: pulseSyncDelay() }}
                alt={activeCharacter.name}
                onClick={() => onCharacterClick?.(activeCharacter)}
              />
            ) : (
              <div
                className="w-20 h-20 rounded-2xl border-2 border-amber-500 animate-pulse bg-slate-700 shrink-0 cursor-pointer"
                onClick={() => onCharacterClick?.(activeCharacter)}
              />
            )}
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-black text-base truncate">{activeCharacter.name}</span>
                <span className={`text-xs font-black shrink-0 ${getHpColors(activeCharacter.hp, activeCharacter.max_hp).text}`}>
                  {activeCharacter.hp}/{activeCharacter.max_hp} HP
                </span>
              </div>
              <div className="text-sm text-slate-400 truncate">
                {activeCharacter.class} · {activeCharacter.species}
              </div>
              {/* HP bar */}
              <div className="h-2 rounded-full bg-slate-700 w-full mt-0.5">
                <div
                  className={`h-2 rounded-full transition-all ${getHpColors(activeCharacter.hp, activeCharacter.max_hp).bar}`}
                  style={{ width: `${Math.max(0, (activeCharacter.hp / activeCharacter.max_hp) * 100)}%` }}
                />
              </div>
              {/* Inline stats row */}
              <div className="flex flex-col gap-1 mt-1">
                <div className="flex items-center gap-3">
                  {(['might', 'magic', 'mischief'] as const).map(stat => {
                    const base = activeCharacter.stats[stat];
                    const bonusItems = activeCharacter.inventory.filter(item => (item.statBonuses?.[stat] ?? 0) > 0);
                    const effectBuffs = (activeCharacter.buffs ?? []).filter(buff => (buff.statBonuses?.[stat] ?? 0) !== 0);
                    const itemBonus = bonusItems.reduce((s, item) => s + (item.statBonuses![stat]!), 0);
                    const effectModifier = Math.min(3, Math.max(-3, effectBuffs.reduce((s, buff) => s + (buff.statBonuses![stat]!), 0)));
                    const modifier = itemBonus + effectModifier;
                    const total = base + modifier;
                    const hasModifier = modifier !== 0;
                    const isOpen = expandedStat === stat;

                    const inner = (
                      <>
                        <StatImg stat={stat} size="5" tooltip className="rounded" />
                        <span className={`text-sm font-black tabular-nums ${hasModifier ? (modifier > 0 ? 'text-amber-400' : 'text-rose-300') : STAT_TEXT_COLORS[stat]}`}>{total}</span>
                        {hasModifier && (
                          <span className={`text-[11px] leading-none transition-transform duration-150 inline-block ${modifier > 0 ? 'text-amber-500/70' : 'text-rose-300/80'} ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                        )}
                      </>
                    );

                    if (!hasModifier) {
                      return <div key={stat} className="flex items-center gap-1">{inner}</div>;
                    }

                    return (
                      <button
                        key={stat}
                        type="button"
                        onClick={() => setExpandedStat(s => s === stat ? null : stat)}
                        className="flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-300 rounded"
                        aria-expanded={isOpen}
                      >
                        {inner}
                      </button>
                    );
                  })}
                  <Tooltip content="Gear [i]" position="top" portal wrapperClassName="inline-flex ml-auto">
                    <button
                      type="button"
                      onClick={onShowPartyGear}
                      className="flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-300 rounded"
                      aria-label="Show party gear"
                    >
                      <img
                        src={imgSrc('/images/icon_inventory.png')}
                        alt="gear"
                        className="w-5 h-5 object-contain mix-blend-screen"
                      />
                    </button>
                  </Tooltip>
                </div>
                {/* Active buffs/curses */}
                {(activeCharacter.buffs ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {(activeCharacter.buffs ?? []).map(buff => {
                      const isCurse = buff.kind === 'curse';
                      const duration = buff.remainingTurns !== undefined
                        ? `${buff.remainingTurns} turn${buff.remainingTurns !== 1 ? 's' : ''} left`
                        : buff.remainingUses !== undefined
                          ? `${buff.remainingUses} use${buff.remainingUses !== 1 ? 's' : ''} left`
                          : 'permanent';
                      const statLine = buff.statBonuses
                        ? Object.entries(buff.statBonuses)
                          .filter(([, v]) => v !== 0)
                          .map(([k, v]) => `${v! > 0 ? '+' : ''}${v} ${k}`)
                          .join(', ')
                        : '';
                      const tooltipText = [buff.description, statLine && `(${statLine})`, duration].filter(Boolean).join(' - ');
                      return (
                        <Tooltip key={buff.id} content={tooltipText} position="top" portal wrapperClassName="inline-flex">
                          <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-wide ${isCurse ? 'bg-rose-950/50 border-rose-700/50 text-rose-300' : 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300'}`}>
                            {buff.name}
                          </span>
                        </Tooltip>
                      );
                    })}
                  </div>
                )}
                {expandedStat && (() => {
                  const key = expandedStat as 'might' | 'magic' | 'mischief';
                  const bonusItems = activeCharacter.inventory.filter(item => (item.statBonuses?.[key] ?? 0) > 0);
                  const effectBuffs = (activeCharacter.buffs ?? []).filter(buff => (buff.statBonuses?.[key] ?? 0) !== 0);
                  const base = activeCharacter.stats[key];
                  return bonusItems.length > 0 || effectBuffs.length > 0 ? (
                    <div className="flex flex-col gap-0.5 px-1 py-1.5 rounded-lg bg-slate-700/30 text-xs border border-slate-700/50">
                      <div className="text-slate-400">{base} base</div>
                      {bonusItems.map(item => (
                        <div key={item.id} className="text-amber-400">+{item.statBonuses![key]} {item.name}</div>
                      ))}
                      {effectBuffs.map(buff => (
                        <div key={buff.id} className={buff.kind === 'curse' ? 'text-rose-300' : 'text-emerald-300'}>{buff.statBonuses![key]! > 0 ? '+' : ''}{buff.statBonuses![key]} {buff.name}</div>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 px-4 pb-4" data-tutorial="action-input">

        {/* Downed state OR action area */}
        {isDown ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8 px-6 bg-slate-800/30 rounded-2xl border border-slate-700/50 text-center">
            {activeCharacter && (
              <img src={imgSrc(activeCharacter.avatarUrl)} className="w-12 h-12 rounded-full object-cover grayscale opacity-50 border-2 border-slate-700" alt="" />
            )}
            <div className="font-semibold text-sm text-slate-400">
              {activeCharacter?.name} is downed
            </div>
            <p className="text-slate-500 text-xs">
              {party.every(c => c.status === 'downed')
                ? 'The whole party is down...'
                : 'Another party member needs to use a healing item.'}
            </p>
          </div>
        ) : (
          <>
            {/* What do you try? (the main action surface) + UNLEASH */}
            <div className="flex flex-col gap-2 pt-1">
              {clarification && (
                <div ref={clarificationRef} role="status" className="scroll-mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="text-xs font-black uppercase tracking-widest text-amber-400">The DM asks</p>
                  <p id={CLARIFICATION_ID} className="mt-1 text-base font-bold text-amber-100 break-words">{clarification.question}</p>
                  <p className="mt-1 text-xs text-slate-400 break-words">About: “{clarification.originalDraft}”</p>
                  <button
                    type="button"
                    onClick={startOverClarification}
                    disabled={statThinking}
                    className="mt-1 -ml-2 min-h-11 px-2 text-sm font-bold text-slate-300 underline underline-offset-2 hover:text-amber-300 disabled:opacity-40"
                  >
                    Start over
                  </button>
                </div>
              )}
              {previewNotice && (
                <div role="status" className="rounded-xl border border-slate-600 bg-slate-800 p-3 text-sm text-amber-200">
                  {previewNotice}
                </div>
              )}
              <div className="flex items-center justify-between gap-2 px-1">
                <label htmlFor={ACTION_INPUT_ID} className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {clarification ? 'Your answer to the DM' : 'What do you try?'}
                </label>
                <button
                  type="button"
                  onClick={toggleAlwaysConfirm}
                  aria-pressed={alwaysConfirm}
                  className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:border-slate-500 hover:text-slate-300"
                >
                  {alwaysConfirm ? 'Asking before sending' : 'Ask before sending'}
                </button>
              </div>
              {pendingSend && (
                <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <p className="min-w-0 text-sm text-amber-100">
                    <span className="font-black">Sending: </span>
                    <span>{pendingSend.interpretedAction}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setPendingSend(null)}
                    className="shrink-0 rounded-full border border-amber-400/60 px-3 py-1 text-xs font-black uppercase tracking-widest text-amber-200 hover:bg-amber-500/20"
                  >
                    Undo <kbd className="ml-1 hidden rounded border border-amber-400/40 px-1 font-mono text-[10px] normal-case tracking-normal md:inline">Esc</kbd>
                  </button>
                </div>
              )}
              {attachment && (
                <div className="flex items-center gap-2 self-start rounded-full border border-amber-600/50 bg-amber-950/30 py-1 pl-3 pr-1 text-xs font-bold text-amber-200">
                  <span>Gear: {attachment.label}</span>
                  <button
                    type="button"
                    onClick={onClearAttachment}
                    aria-label={`Remove ${attachment.label} from the action`}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-amber-300 hover:bg-amber-900/60 hover:text-amber-100"
                  >
                    ×
                  </button>
                </div>
              )}
              <div className="relative">
                <div className="absolute -top-2.5 -left-2.5 z-20 hidden md:block">
                  <Tooltip content={`Focus custom action [${customActionShortcut}]`} position="bottom" portal wrapperClassName="inline-flex">
                    <span className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-400">
                      {customActionShortcut}
                    </span>
                  </Tooltip>
                </div>
                <textarea
                  id={ACTION_INPUT_ID}
                  ref={textareaRef}
                  value={customAction}
                  onChange={e => setCustomAction(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitCustom();
                    } else if (e.key === 'Escape' && clarification) {
                      e.preventDefault();
                      startOverClarification();
                    }
                  }}
                  aria-describedby={clarification ? CLARIFICATION_ID : undefined}
                  rows={2}
                  placeholder={clarification ? 'Your answer...' : ACTION_EXAMPLES[(turn?.id ?? 0) % ACTION_EXAMPLES.length]}
                  disabled={loading || statThinking}
                  className="w-full p-3 bg-slate-800 rounded-xl resize-none text-sm border border-slate-700 focus:border-amber-500/40 outline-none transition-colors placeholder-slate-600"
                />
                <SpeechActionButton
                  enabled={sttSettings.enabled}
                  supported={speech.isSupported}
                  active={speechActive}
                  disabled={speechButtonDisabled}
                  errorMessage={speech.errorMessage}
                  onClick={toggleSpeech}
                />
              </div>
              <div className="relative">
                <ShortcutBadge keyLabel="u" description="Unleash" />
                <button
                  onClick={submitCustom}
                  disabled={loading || statThinking || previewThinking || !!pendingSend || !customAction.trim()}
                  className="w-full py-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 rounded-2xl font-black uppercase tracking-tighter text-xl xl:text-2xl shadow-[0_6px_0_rgb(146,64,14)] transition-all italic"
                >
                  {statThinking || previewThinking ? 'Thinking...' : 'UNLEASH'}
                </button>
              </div>
              {!clarification && (
                <div className="relative self-end">
                  <ShortcutBadge keyLabel="d" description="Ask the DM" />
                  <Tooltip content="Ask a question about the scene without taking a turn" position="top" portal wrapperClassName="inline-flex">
                    <button
                      type="button"
                      onClick={requestAsk}
                      disabled={askLoading || loading || statThinking || previewThinking || !!pendingSend || turn?.id === undefined}
                      className="min-h-11 px-2 text-sm font-bold text-sky-300 underline underline-offset-2 hover:text-sky-200 disabled:opacity-40"
                    >
                      {askLoading ? 'The DM is answering...' : 'Ask the DM instead'}
                    </button>
                  </Tooltip>
                </div>
              )}
              {visibleAnswer && (
                <div role="status" className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3">
                  <p className="text-xs text-slate-400 break-words">You asked: “{visibleAnswer.question}”</p>
                  <p className="mt-1 text-xs font-black uppercase tracking-widest text-sky-300">The DM says</p>
                  <p className="mt-1 text-sm text-sky-50 break-words">{visibleAnswer.answer}</p>
                  <button
                    type="button"
                    onClick={() => setDmAnswer(null)}
                    className="mt-1 -ml-2 min-h-11 px-2 text-sm font-bold text-slate-300 underline underline-offset-2 hover:text-sky-200"
                  >
                    Got it
                  </button>
                </div>
              )}
              {askHint && !customAction.trim() && !clarification && (
                <p role="status" className="text-sm text-sky-200">Type your question in the box above, then tap Ask the DM.</p>
              )}
              {askError && (
                <div role="status" className="rounded-xl border border-rose-700/40 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">
                  {askError}
                </div>
              )}
            </div>

            <div ref={helpRef} className="relative">
              <ShortcutBadge keyLabel="o" description="Help someone" />
              <HelpSomeone
                open={helpOpen}
                onOpenChange={setHelpOpen}
                party={party}
                activeCharacterId={activeCharacter?.id}
                disabled={loading || statThinking || previewThinking || !!pendingSend}
                onBless={onBless}
                onAid={onAid}
                onRally={onRally}
              />
            </div>

            {/* Ideas: suggestions on request */}
            {choices.length === 0 && turn?.id !== undefined && (
              <div className="relative flex flex-col gap-2">
                <ShortcutBadge keyLabel="g" description="Give me ideas" />
                <button
                  type="button"
                  onClick={() => {
                    void askForIdeas(false);
                  }}
                  disabled={ideasLoading || loading}
                  className="w-full py-3 rounded-2xl border-2 border-sky-500/50 bg-sky-500/10 text-sky-100 font-black uppercase tracking-wide text-base hover:bg-sky-500/20 disabled:opacity-50 transition-colors"
                >
                  {ideasLoading ? 'The DM is thinking...' : 'Give me ideas'}
                </button>
                {ideasError && (
                  <div role="status" className="flex items-center justify-between gap-2 rounded-xl border border-rose-700/40 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">
                    <span>{ideasError}</span>
                    <button
                      type="button"
                      onClick={() => {
                        void askForIdeas(false);
                      }}
                      disabled={ideasLoading}
                      className="shrink-0 text-xs font-bold underline underline-offset-2 hover:text-rose-100 disabled:opacity-40"
                    >
                      Try again
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Idea cards */}
            {choices.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 px-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Ideas</div>
                  <button
                    type="button"
                    onClick={toggleShowNumbers}
                    aria-pressed={showNumbers}
                    className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:border-slate-500 hover:text-slate-300"
                  >
                    {showNumbers ? 'Hide the numbers' : 'Show the numbers'}
                  </button>
                </div>
                {turn?.ideasDegraded && (
                  <div className="flex items-center justify-between gap-2 px-1 text-xs text-slate-500">
                    <span>Quick ideas while the DM was busy.</span>
                    <button
                      type="button"
                      onClick={() => {
                        void askForIdeas(true);
                      }}
                      disabled={ideasLoading}
                      className="font-bold underline underline-offset-2 hover:text-slate-300 disabled:opacity-40"
                    >
                      {ideasLoading ? 'Thinking...' : 'Try again'}
                    </button>
                  </div>
                )}
                {choices.map((choice, i) => {
                  const flavorBadge = choice.flavor && choice.flavor !== 'standard' ? CHOICE_FLAVOR_BADGES[choice.flavor] : null;
                  const risk = RISK_MAP[choice.difficulty] ?? RISK_MAP.normal;
                  const { isRiddleAnswer, statBonus, buffBonus, helperBonus, choiceItemBonus, characterBonus, characterBonusLabel, statTotal, target, prob } = computeChoiceOdds(choice, activeCharacter, party);
                  const shortcut = i + 1;

                  return (
                    <div key={i} className="relative">
                      <div className="absolute -top-2.5 -left-2.5 z-20 hidden md:block">
                        <Tooltip content={`Focus action ${shortcut} [${shortcut}]`} position="bottom" portal wrapperClassName="inline-flex">
                          <span className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-400">
                            {shortcut}
                          </span>
                        </Tooltip>
                      </div>
                      <button
                        type="button"
                        ref={el => {
                          choiceButtonRefs.current[i] = el;
                        }}
                        onClick={() => {
                          void submitSuggestedChoice(i);
                        }}
                        disabled={loading}
                        className={`relative w-full p-3 rounded-2xl border-2 text-left transition-all hover:brightness-110 disabled:opacity-50 ${STAT_COLORS[choice.stat]}`}
                      >
                        <div className="font-black text-base xl:text-lg uppercase leading-tight">{choice.label}</div>
                        {choice.narration && (
                          <div className="text-xs italic text-slate-300/70 mt-0.5 leading-snug">{choice.narration}</div>
                        )}
                        {flavorBadge && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold uppercase tracking-wider ${flavorBadge.className}`}>{flavorBadge.label}</span>
                            {choice.helperCharacterName && (
                              <span className="px-2 py-0.5 rounded-full border border-slate-600/70 bg-slate-950/40 text-xs font-medium text-slate-300">with {choice.helperCharacterName.split(' ')[0]}</span>
                            )}
                            {choice.itemName && (
                              <span className="px-2 py-0.5 rounded-full border border-slate-600/70 bg-slate-950/40 text-xs font-medium text-slate-300 truncate max-w-[11rem]">{choice.itemName}</span>
                            )}
                            {choice.environmentFeature && (
                              <span className="px-2 py-0.5 rounded-full border border-slate-600/70 bg-slate-950/40 text-xs font-medium text-slate-300 truncate max-w-[11rem]">{choice.environmentFeature}</span>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {isRiddleAnswer ? (
                            <>
                              <span className="px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-950/30 text-amber-300 text-xs font-semibold uppercase tracking-wider">Riddle Answer</span>
                              <span className="text-xs text-slate-500 font-black ml-auto">No roll</span>
                            </>
                          ) : (
                            <>
                              <StatImg stat={choice.stat} size="4" tooltip className="rounded-xl" />
                              {showNumbers && (
                                <>
                                  <span className="text-xs font-black">
                                    <span className={(statBonus + buffBonus) > 0 ? 'text-amber-400' : (statBonus + buffBonus) < 0 ? 'text-rose-300' : (STAT_TEXT_COLORS[choice.stat] ?? 'text-slate-300')}>{statTotal}</span>
                                    <span className="text-slate-400"> vs {target}</span>
                                  </span>
			      {helperBonus > 0 && (
                                    <span className="text-xs font-black text-cyan-300">+{formatHelperBonusLabel(helperBonus, choice.helperCharacterName)}</span>
			      )}
			      {choiceItemBonus > 0 && (
                                    <span className="text-xs font-black text-amber-300">+{formatChoiceItemBonusLabel(choiceItemBonus, choice.itemName)}</span>
			      )}
			      {characterBonus > 0 && (
                                    <span className="text-xs font-black text-fuchsia-300">+{formatCharacterBonusLabel(characterBonus, characterBonusLabel)}</span>
			      )}
                                </>
                              )}
                              <span className={`text-xs font-semibold uppercase tracking-wider ${risk.color}`}>{risk.label}</span>
                              {showNumbers && (
                                <span className="text-xs text-slate-500 font-medium ml-auto">{prob}%</span>
                              )}
                            </>
                          )}
                        </div>
                      </button>
                      {ttsEnabled && (
                        <div className="absolute -top-2.5 -right-2.5 z-20">
                          <Tooltip content="Read aloud" position="bottom" portal wrapperClassName="inline-flex">
                            <button
                              type="button"
                              onClick={() => {
                                const text = choice.narration ? `${choice.label}. ${choice.narration}` : choice.label;
                                browserTtsService.speakNarration(text, ttsSettings);
                              }}
                              disabled={loading}
                              className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-900 border border-slate-700 text-xs text-slate-400 hover:text-amber-400 hover:border-amber-500/50 transition-colors disabled:opacity-40"
                              aria-label="Read aloud"
                            >
                              🔊
                            </button>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        <SpeechConfirmDialog
          intent={speechIntent}
          turn={turn}
          submitting={speech.state.status === 'submitting'}
          onConfirm={() => {
            void speech.confirmTranscript();
          }}
          onRetry={speech.retryListening}
          onCancel={speech.cancel}
        />
        {freeActionPreview && (() => {
          const previewStat = freeActionPreview.stat;
          const base = activeCharacter?.stats[previewStat] ?? 0;
          const itemBonus = activeCharacter?.inventory.reduce((s, item) => s + (item.statBonuses?.[previewStat] ?? 0), 0) ?? 0;
          return (
            <FreeActionConfirmDialog
              preview={freeActionPreview}
              statBonus={base + itemBonus}
              submitting={previewSubmitting}
              showOriginalAction
              onConfirm={useOriginalAction => {
                void confirmFreeAction(useOriginalAction);
              }}
              onEdit={editFreeAction}
              onCancel={cancelFreeAction}
            />
          );
        })()}
      </div>
    </div>
  );
};
