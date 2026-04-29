import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { TurnResult, Character } from '../../types';
import { apiFetch, imgSrc, pulseSyncDelay } from '../../lib/api';
import { beatTarget } from '../../lib/game';
import { StatImg } from './StatIcon';
import { STAT_COLORS } from '../../lib/statColors';
import { getHpColors } from '../../lib/hpColors';
import { useTtsSettings } from '../../tts/useTtsSettings';
import { browserTtsService } from '../../tts/browserTtsService';
import { narrationTtsService } from '../../tts/narrationTtsService';
import { useSttSettings } from '../../stt/useSttSettings';
import { useSpeechRecognition } from '../../stt/useSpeechRecognition';
import { parseSpeechIntent } from '../../stt/speechIntent';
import { SpeechActionButton } from './SpeechActionButton';
import { SpeechConfirmDialog } from './SpeechConfirmDialog';
import { Tooltip } from '../Tooltip';

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
  onSubmit: (label: string, stat: string, diff: string, difficultyValue?: number) => Promise<void> | void;
  onShowPartyGear: () => void;
  onActiveStatChange?: (statKey: string | null) => void;
}

const RISK_MAP: Record<string, { label: string; color: string }> = {
  easy: { label: 'Favorable', color: 'text-emerald-400' },
  normal: { label: 'Risky', color: 'text-amber-400' },
  hard: { label: 'Tough', color: 'text-rose-400' },
};

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
  onActiveStatChange,
}: ActionDockProps) => {
  const [statThinking, setStatThinking] = useState(false);
  const choiceButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { settings: ttsSettings } = useTtsSettings();
  const { settings: sttSettings } = useSttSettings();
  const ttsEnabled = ttsSettings.enabled && browserTtsService.isSupported();

  const submitSuggestedChoice = useCallback(async (index: 0 | 1 | 2) => {
    const choice = turn?.choices[index];
    if (!choice || loading) {
      return;
    }
    await onSubmit(choice.label, choice.stat, choice.difficulty, choice.difficultyValue);
  }, [loading, onSubmit, turn]);

  const submitCustomText = useCallback(async (actionText: string) => {
    const trimmed = actionText.trim();
    if (!trimmed || loading) {
      return;
    }
    setStatThinking(true);
    let stat = 'mischief';
    try {
      const res = await apiFetch(`/session/${sessionId}/suggest-stat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: trimmed,
          characterClass: activeCharacter?.class,
          characterQuirk: activeCharacter?.quirk,
        }),
      });
      if (res.ok) {
        ({ stat } = await res.json());
      }
    } catch { /* fallback to mischief */ }
    setStatThinking(false);
    await onSubmit(trimmed, stat, 'normal');
  }, [activeCharacter, loading, onSubmit, sessionId]);

  const confirmSpeechTranscript = useCallback(async (transcript: string) => {
    const intent = parseSpeechIntent(transcript);
    if (intent.type === 'choice' && turn?.choices[intent.index]) {
      await submitSuggestedChoice(intent.index);
      return;
    }

    const text = intent.type === 'custom' ? intent.text : transcript.trim();
    setCustomAction(text);
    await submitCustomText(text);
  }, [setCustomAction, submitCustomText, submitSuggestedChoice, turn]);

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

      const choices = turn?.choices ?? [];
      if (e.key === '1' && choices[0]) {
        choiceButtonRefs.current[0]?.focus();
      } else if (e.key === '2' && choices[1]) {
        choiceButtonRefs.current[1]?.focus();
      } else if (e.key === '3' && choices[2]) {
        choiceButtonRefs.current[2]?.focus();
      } else if (e.key === '4') {
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
  }, [loading, isDown, turn, onShowPartyGear, toggleSpeech]);

  const submitCustom = async () => {
    await submitCustomText(customAction);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-[32px] border border-slate-800 overflow-hidden">
      {/* Fixed top section: error + active character info */}
      <div className="flex flex-col gap-3 p-4 flex-shrink-0">
        {error && (
          <div className="px-4 py-2 bg-rose-950/60 border border-rose-700 rounded-xl text-rose-300 text-xs font-black uppercase tracking-widest">
            {error}
          </div>
        )}

        {/* Active hero panel */}
        {activeCharacter && (
          <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-2xl border border-slate-700/50">
            <img
              src={imgSrc(activeCharacter.avatarUrl)}
              className="w-20 h-20 rounded-2xl object-cover border-2 border-amber-500 animate-border-pulse shrink-0"
              style={{ animationDelay: pulseSyncDelay() }}
              alt={activeCharacter.name}
            />
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-black text-base uppercase tracking-wide truncate">{activeCharacter.name}</span>
                <span className={`text-xs font-black shrink-0 ${getHpColors(activeCharacter.hp, activeCharacter.max_hp).text}`}>
                  {activeCharacter.hp}/{activeCharacter.max_hp} HP
                </span>
              </div>
              <div className="text-sm text-slate-400 uppercase tracking-wide truncate">
                {activeCharacter.class} · {activeCharacter.species}
              </div>
              {/* HP bar */}
              <div className="h-1 rounded-full bg-slate-700 w-full mt-0.5">
                <div
                  className={`h-1 rounded-full transition-all ${getHpColors(activeCharacter.hp, activeCharacter.max_hp).bar}`}
                  style={{ width: `${Math.max(0, (activeCharacter.hp / activeCharacter.max_hp) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Scrollable area: actions only */}
      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 pb-4">

        {/* Downed state OR action area */}
        {isDown ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8 px-6 bg-slate-800/30 rounded-2xl border border-slate-700/50 text-center">
            {activeCharacter && (
              <img src={imgSrc(activeCharacter.avatarUrl)} className="w-12 h-12 rounded-full object-cover grayscale opacity-50 border-2 border-slate-700" alt="" />
            )}
            <div className="font-black text-sm uppercase tracking-widest text-slate-400">
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
                <div className="text-xs font-black uppercase tracking-widest text-slate-500 px-1">Choose an Action</div>
                {turn.choices.map((choice, i) => {
                  const risk = RISK_MAP[choice.difficulty] ?? RISK_MAP.normal;
                  const statTotal = activeCharacter
                    ? activeCharacter.stats[choice.stat as keyof typeof activeCharacter.stats] +
                    activeCharacter.inventory.reduce((s, item) => s + (item.statBonuses?.[choice.stat as keyof typeof item.statBonuses] ?? 0), 0)
                    : 0;
                  const target = beatTarget(choice.difficultyValue, choice.difficulty);
                  const prob = calcProb(statTotal, target);

                  return (
                    <div key={i} className="relative">
                      <div className="absolute -top-2.5 -left-2.5 z-20">
                        <Tooltip content={`Shortcut [${i + 1}]`} position="bottom" portal wrapperClassName="inline-flex">
                          <span className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-900 border border-slate-700 text-[10px] font-black text-slate-400">
                            {i + 1}
                          </span>
                        </Tooltip>
                      </div>
                      <button
                        type="button"
                        ref={el => {
                          choiceButtonRefs.current[i] = el;
                        }}
                        onClick={() => {
                          void submitSuggestedChoice(i as 0 | 1 | 2);
                        }}
                        onMouseEnter={() => onActiveStatChange?.(choice.stat)}
                        onMouseLeave={() => onActiveStatChange?.(null)}
                        onFocus={() => onActiveStatChange?.(choice.stat)}
                        onBlur={() => onActiveStatChange?.(null)}
                        disabled={loading}
                        className={`relative w-full p-3 ${ttsEnabled ? 'pr-10' : ''} rounded-2xl border-2 text-left transition-all hover:brightness-110 disabled:opacity-50 ${STAT_COLORS[choice.stat]}`}
                      >
                        <div className="font-black text-base xl:text-lg uppercase leading-tight">{choice.label}</div>
                        {choice.narration && (
                          <div className="text-xs italic text-slate-300/70 mt-0.5 leading-snug">{choice.narration}</div>
                        )}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <StatImg stat={choice.stat} size="12" tooltip className="rounded-xl" />
                          <span className="text-xs text-slate-400 font-black">
                            {statTotal} vs {target}
                          </span>
                          <span className={`text-xs font-black uppercase tracking-widest ${risk.color}`}>{risk.label}</span>
                          <span className="text-xs text-slate-500 font-black ml-auto">{prob}%</span>
                        </div>
                      </button>
                      {ttsEnabled && (
                        <button
                          type="button"
                          onClick={() => {
                            const text = choice.narration ? `${choice.label}. ${choice.narration}` : choice.label;
                            browserTtsService.speakNarration(text, ttsSettings);
                          }}
                          disabled={loading}
                          className="absolute top-3 right-3 z-10 w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 text-sm transition-colors disabled:opacity-40"
                          aria-label="Read aloud"
                        >
                          🔊
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Command bar + UNLEASH */}
            <div className="flex flex-col gap-2 pt-1">
              <div className="relative">
                <div className="absolute -top-2.5 -left-2.5 z-20">
                  <Tooltip content="Shortcut [4]" position="bottom" portal wrapperClassName="inline-flex">
                    <span className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-900 border border-slate-700 text-[10px] font-black text-slate-400">
                      4
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
                {statThinking ? '...' : 'UNLEASH'}
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
      </div>
    </div>
  );
};
