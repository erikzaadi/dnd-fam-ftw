import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { TurnResult, Character, FreeActionPreview } from '../../types';
import { apiFetch, imgSrc, pulseSyncDelay } from '../../lib/api';
import { beatTarget } from '../../lib/game';
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
import { formatCharacterBonusLabel, formatChoiceItemBonusLabel, formatHelperBonusLabel } from './rollBonusLabels';
interface ActionDockProps {
  turn: TurnResult | null;
  loading: boolean;
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
}

interface ActionPreviewBonuses {
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

const CHOICE_FLAVOR_BADGES: Record<string, { label: string; className: string }> = {
  spotlight: { label: 'Spotlight', className: 'bg-fuchsia-950/40 border-fuchsia-700/50 text-fuchsia-300' },
  combo: { label: 'Team Up', className: 'bg-cyan-950/40 border-cyan-700/50 text-cyan-300' },
  social: { label: 'Social', className: 'bg-violet-950/40 border-violet-700/50 text-violet-300' },
  item: { label: 'Gear', className: 'bg-amber-950/40 border-amber-700/50 text-amber-300' },
  environment: { label: 'Obstacle', className: 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300' },
};

const COMBO_HELPER_BONUS = 2;
const CHOICE_ITEM_BONUS = 2;
const CHARACTER_EDGE_BONUS = 2;

const calcProb = (statTotal: number, target: number) => {
  const minNeeded = Math.max(1, Math.min(20, target - statTotal));
  return Math.round(((21 - minNeeded) / 20) * 100);
};


export const ActionDock = ({
  turn,
  loading,
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
}: ActionDockProps) => {
  const [statThinking, setStatThinking] = useState(false);
  const [expandedStat, setExpandedStat] = useState<string | null>(null);
  const [freeActionPreview, setFreeActionPreview] = useState<FreeActionPreview | null>(null);
  const [previewSubmitting, setPreviewSubmitting] = useState(false);
  const choiceButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { settings: ttsSettings } = useTtsSettings();
  const { settings: sttSettings } = useSttSettings();
  const ttsEnabled = ttsSettings.enabled && browserTtsService.isSupported();

  const choices = useMemo(() => turn?.choices ?? [], [turn?.choices]);
  const customActionShortcut = choices.length + 1;

  const submitSuggestedChoice = useCallback(async (index: number) => {
    const choice = choices[index];
    if (!choice || loading) {
      return;
    }
    const hasActiveHelper = choice.flavor === 'combo' && !!choice.helperCharacterName && party.some(c => c.name === choice.helperCharacterName && c.status === 'active' && c.id !== activeCharacter?.id);
    const choiceItemOwner = choice.flavor === 'item' && choice.itemOwnerName
      ? party.find(c => c.name === choice.itemOwnerName && c.status === 'active')
      : null;
    const choiceItem = choiceItemOwner && choice.itemName
      ? choiceItemOwner.inventory.find(item => item.name === choice.itemName)
      : null;
    const preview: ActionPreviewBonuses = {
      ...(hasActiveHelper && { helperBonus: COMBO_HELPER_BONUS, helperCharacterName: choice.helperCharacterName }),
      ...(choiceItem && choiceItemOwner && { choiceItemBonus: CHOICE_ITEM_BONUS, choiceItemName: choiceItem.name, choiceItemOwnerName: choiceItemOwner.name }),
      ...(choice.flavor === 'spotlight' && { characterBonus: CHARACTER_EDGE_BONUS, characterBonusLabel: 'spotlight', flavor: 'spotlight' }),
      ...(choice.flavor === 'social' && { characterBonus: CHARACTER_EDGE_BONUS, characterBonusLabel: 'social edge', flavor: 'social' }),
    };
    await onSubmit(choice.label, choice.stat, choice.difficulty, choice.difficultyValue, undefined, undefined, undefined, preview);
  }, [activeCharacter, choices, loading, onSubmit, party]);

  const submitCustomText = useCallback(async (actionText: string) => {
    const trimmed = actionText.trim();
    if (!trimmed || loading) {
      return;
    }
    setStatThinking(true);
    let preview: FreeActionPreview = {
      originalAction: trimmed,
      interpretedAction: trimmed,
      stat: 'mischief',
      difficulty: 'normal',
      warnings: [],
    };
    let previewFailed = false;
    try {
      const res = await apiFetch(`/session/${sessionId}/preview-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: trimmed,
        }),
      });
      if (res.ok) {
        const responsePreview = await res.json() as Partial<FreeActionPreview>;
        preview = {
          ...preview,
          ...responsePreview,
          originalAction: responsePreview.originalAction ?? trimmed,
          interpretedAction: responsePreview.interpretedAction ?? trimmed,
          difficulty: responsePreview.difficulty ?? preview.difficulty,
          warnings: responsePreview.warnings ?? [],
        };
      } else {
        previewFailed = true;
      }
    } catch {
      previewFailed = true;
    }
    setStatThinking(false);
    if (previewFailed) {
      preview = {
        ...preview,
        warnings: ['Preview failed - submitting with default stat. You can still confirm or cancel.'],
      };
    }
    setFreeActionPreview(preview);
  }, [loading, sessionId]);

  const confirmFreeAction = useCallback(async () => {
    if (!freeActionPreview) {
      return;
    }
    setPreviewSubmitting(true);
    const preview: ActionPreviewBonuses = {
      ...(freeActionPreview.helperBonus !== undefined && { helperBonus: freeActionPreview.helperBonus }),
      ...(freeActionPreview.helperCharacterName !== undefined && { helperCharacterName: freeActionPreview.helperCharacterName }),
      ...(freeActionPreview.choiceItemBonus !== undefined && { choiceItemBonus: freeActionPreview.choiceItemBonus }),
      ...(freeActionPreview.choiceItemName !== undefined && { choiceItemName: freeActionPreview.choiceItemName }),
      ...(freeActionPreview.choiceItemOwnerName !== undefined && { choiceItemOwnerName: freeActionPreview.choiceItemOwnerName }),
      ...(freeActionPreview.characterBonus !== undefined && { characterBonus: freeActionPreview.characterBonus }),
      ...(freeActionPreview.characterBonusLabel !== undefined && { characterBonusLabel: freeActionPreview.characterBonusLabel }),
      ...(freeActionPreview.flavor !== undefined && { flavor: freeActionPreview.flavor }),
    };
    const { originalAction, stat, difficulty, difficultyValue } = freeActionPreview;
    setFreeActionPreview(null);
    setPreviewSubmitting(false);
    await onSubmit(originalAction, stat, difficulty, difficultyValue, undefined, undefined, undefined, preview);
  }, [freeActionPreview, onSubmit]);

  const editFreeAction = useCallback(() => {
    if (!freeActionPreview) {
      return;
    }
    setCustomAction(freeActionPreview.interpretedAction);
    setFreeActionPreview(null);
  }, [freeActionPreview, setCustomAction]);

  const cancelFreeAction = useCallback(() => {
    setFreeActionPreview(null);
  }, []);

  const submitCustomTextDirect = useCallback(async (actionText: string) => {
    const trimmed = actionText.trim();
    if (!trimmed || loading) {
      return;
    }
    let stat = 'mischief';
    let preview: ActionPreviewBonuses = {};
    try {
      const res = await apiFetch(`/session/${sessionId}/suggest-stat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: trimmed,
        }),
      });
      if (res.ok) {
        const suggestion = await res.json();
        ({ stat, ...preview } = suggestion);
      }
    } catch { /* fallback to mischief */ }
    await onSubmit(trimmed, stat, 'normal', undefined, undefined, undefined, undefined, preview);
  }, [loading, onSubmit, sessionId]);

  const confirmSpeechTranscript = useCallback(async (transcript: string) => {
    const intent = parseSpeechIntent(transcript);
    if (intent.type === 'choice' && turn?.choices[intent.index]) {
      await submitSuggestedChoice(intent.index);
      return;
    }

    const text = intent.type === 'custom' ? intent.text : transcript.trim();
    setCustomAction(text);
    await submitCustomTextDirect(text);
  }, [setCustomAction, submitCustomTextDirect, submitSuggestedChoice, turn]);

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

      if (inTextField) {
        if (e.key === 'Escape') {
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
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [choices, customActionShortcut, loading, isDown, onShowPartyGear, toggleSpeech]);

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
            <img
              src={imgSrc(activeCharacter.avatarUrl)}
              className="w-20 h-20 rounded-2xl object-cover border-2 border-amber-500 animate-border-pulse shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
              style={{ animationDelay: pulseSyncDelay() }}
              alt={activeCharacter.name}
              onClick={() => onCharacterClick?.(activeCharacter)}
            />
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
            {/* Action cards */}
            {turn?.choices && turn.choices.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 px-1">Choose an Action</div>
                {turn.choices.map((choice, i) => {
                  const isRiddleAnswer = !!choice.riddleAnswer;
                  const flavorBadge = choice.flavor && choice.flavor !== 'standard' ? CHOICE_FLAVOR_BADGES[choice.flavor] : null;
                  const risk = RISK_MAP[choice.difficulty] ?? RISK_MAP.normal;
                  const statBase = activeCharacter?.stats[choice.stat as keyof typeof activeCharacter.stats] ?? 0;
                  const statBonus = activeCharacter?.inventory.reduce((s, item) => s + (item.statBonuses?.[choice.stat as keyof typeof item.statBonuses] ?? 0), 0) ?? 0;
                  const hasActiveHelper = choice.flavor === 'combo' && !!choice.helperCharacterName && party.some(c => c.name === choice.helperCharacterName && c.status === 'active' && c.id !== activeCharacter?.id);
                  const helperBonus = hasActiveHelper ? COMBO_HELPER_BONUS : 0;
                  const hasChoiceItem = choice.flavor === 'item' && !!choice.itemOwnerName && !!choice.itemName && party.some(c => c.name === choice.itemOwnerName && c.status === 'active' && c.inventory.some(item => item.name === choice.itemName));
                  const choiceItemBonus = hasChoiceItem ? CHOICE_ITEM_BONUS : 0;
                  const characterBonus = choice.flavor === 'spotlight' || choice.flavor === 'social' ? CHARACTER_EDGE_BONUS : 0;
                  const characterBonusLabel = choice.flavor === 'spotlight' ? 'spotlight' : choice.flavor === 'social' ? 'social' : '';
                  const statTotal = statBase + statBonus + helperBonus + choiceItemBonus + characterBonus;
                  const target = beatTarget(choice.difficultyValue, choice.difficulty);
                  const shortcut = i + 1;
                  const prob = calcProb(statTotal, target);

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
                              <span className="text-xs font-black">
                                <span className={statBonus > 0 ? 'text-amber-400' : (STAT_TEXT_COLORS[choice.stat] ?? 'text-slate-300')}>{statTotal}</span>
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
                              <span className={`text-xs font-semibold uppercase tracking-wider ${risk.color}`}>{risk.label}</span>
                              <span className="text-xs text-slate-500 font-medium ml-auto">{prob}%</span>
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

            {/* Command bar + UNLEASH */}
            <div className="flex flex-col gap-2 pt-1">
              <div className="relative">
                <div className="absolute -top-2.5 -left-2.5 z-20 hidden md:block">
                  <Tooltip content={`Focus custom action [${customActionShortcut}]`} position="bottom" portal wrapperClassName="inline-flex">
                    <span className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-400">
                      {customActionShortcut}
                    </span>
                  </Tooltip>
                </div>
                <textarea
                  ref={textareaRef}
                  value={customAction}
                  onChange={e => setCustomAction(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submitCustom();
                    }
                  }}
                  rows={2}
                  placeholder="Describe a different action..."
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
              <button
                onClick={submitCustom}
                disabled={loading || statThinking || !customAction.trim()}
                className="w-full py-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 rounded-2xl font-black uppercase tracking-tighter text-xl xl:text-2xl shadow-[0_6px_0_rgb(146,64,14)] transition-all italic"
              >
                {statThinking ? 'Thinking...' : 'UNLEASH'}
              </button>
            </div>
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
              onConfirm={() => {
                void confirmFreeAction();
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
