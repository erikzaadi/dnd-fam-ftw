import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { TurnResult, Session, Character } from '../types';
import { apiFetch, imgSrc } from '../lib/api';
import { FullscreenImage } from '../components/FullscreenImage';
import { DmFooter } from '../components/DmFooter';
import { SiteHeader } from '../components/SiteHeader';
import { useTtsSettings } from '../tts/useTtsSettings';
import { narrationTtsService } from '../tts/narrationTtsService';
import { NarrationTtsButton } from '../components/NarrationTtsButton';
import { D20 } from '../components/game/D20';
import { StatImg } from '../components/game/StatIcon';
import { RollBreakdown } from '../components/game/RollBreakdown';
import { audioManager } from '../audio/audioManager';
import { SceneBackground } from '../components/game/SceneBackground';
import { STAT_COLORS } from '../lib/statColors';
import { PageLoader } from '../components/PageLoader';
import { KeybindingsHelp } from '../components/KeybindingsHelp';
import { useCapabilities } from '../hooks/useCapabilities';

type Mode = 'choose' | 'tldr' | 'movie';

const MOVIE_INTERVAL_MS = 5000;

// ── TLDR ────────────────────────────────────────────────────────────────────

const TldrView = ({ sessionId, onEnter, hasTts }: { sessionId: string; onEnter: () => void; hasTts: boolean }) => {
  const [summary, setSummary] = useState<string | null>(null);
  const { settings: ttsSettings } = useTtsSettings();

  useEffect(() => {
    apiFetch(`/session/${sessionId}/summary`)
      .then(r => r.json())
      .then(d => setSummary(d.summary));
  }, [sessionId]);

  useEffect(() => {
    if (!summary || !narrationTtsService.isNarrationAvailable(ttsSettings, hasTts, true)) {
      return;
    }
    narrationTtsService.speakNarration({
      text: summary,
      settings: ttsSettings,
      hasTts,
      turnId: `summary:${sessionId}`,
      mainNarration: true,
    });
    return () => {
      narrationTtsService.stopNarration();
    };
  }, [summary, ttsSettings, hasTts, sessionId]);

  return (
    <div className="flex-1 flex flex-col items-center gap-8 w-full max-w-4xl mx-auto px-4 md:px-8 pt-6 pb-24 animate-in fade-in duration-500 relative z-[10]">
      <h2 className="text-3xl font-display font-black text-amber-500 uppercase tracking-widest">The Story So Far</h2>
      {summary ? (
        <>
          <p className="font-narrative text-2xl text-slate-200 leading-relaxed italic text-center">{summary}</p>
          <NarrationTtsButton text={summary} ttsSettings={ttsSettings} hasTts={hasTts} turnId={`summary:${sessionId}`} className="justify-center" />
          <button onClick={onEnter} className="px-12 py-5 bg-amber-600 hover:bg-amber-500 rounded-[28px] font-black uppercase italic tracking-tighter text-2xl shadow-[0_8px_0_rgb(146,64,14)] transition-all animate-in fade-in duration-500">
            Enter Realm
          </button>
        </>
      ) : (
        <p className="text-amber-500 animate-pulse font-black uppercase tracking-widest">Consulting the chronicles...</p>
      )}
    </div>
  );
};

// ── MOVIE ───────────────────────────────────────────────────────────────────

const MovieView = ({ history, party, onEnter, hasTts }: { history: TurnResult[]; party: Character[]; onEnter: () => void; hasTts: boolean }) => {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [fullscreenUrl, setFullscreenUrl] = useState<string | null>(null);
  const { settings: ttsSettings } = useTtsSettings();
  const turn = history[idx];
  const isLast = idx === history.length - 1;
  const actor = turn.characterId ? party.find(c => c.id === turn.characterId) : null;
  const roll = turn.lastAction?.actionResult;
  const hasRoll = roll && roll.statUsed !== 'none';

  // Keyboard nav: space = play/pause, arrows = prev/next
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying(p => !p);
      } else if (e.key === 'ArrowLeft' || e.key === 'h') {
        e.preventDefault();
        setIdx(i => Math.max(0, i - 1));
        setPlaying(false);
      } else if (e.key === 'ArrowRight' || e.key === 'l') {
        e.preventDefault();
        setIdx(i => Math.min(history.length - 1, i + 1));
        setPlaying(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [history.length]);

  // Speak narration on slide change, then advance after speech + pause gap
  useEffect(() => {
    let cancelled = false;
    let advanceTimer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      if (playing && narrationTtsService.isNarrationAvailable(ttsSettings, hasTts, true)) {
        await narrationTtsService.speakNarration({
          text: turn.narration,
          settings: ttsSettings,
          hasTts,
          turnId: turn.id,
          mainNarration: true,
        });
      }
      if (cancelled || !playing || isLast) {
        return;
      }
      await new Promise<void>(resolve => {
        advanceTimer = setTimeout(resolve, MOVIE_INTERVAL_MS);
      });
      if (!cancelled) {
        setIdx(i => i + 1);
      }
    };

    run();

    return () => {
      cancelled = true;
      if (advanceTimer !== null) {
        clearTimeout(advanceTimer);
      }
      narrationTtsService.stopNarration();
    };
  }, [idx, playing, isLast, ttsSettings, turn.id, turn.narration, hasTts]);

  const imageUrl = turn.imageUrl ? imgSrc(turn.imageUrl) : null;
  const defaultImageUrl = imgSrc('/images/default_scene.png');

  return (
    <div className="flex-1 flex min-h-0 w-full animate-in fade-in duration-500 relative z-[10]">
      {fullscreenUrl && <FullscreenImage url={fullscreenUrl} onClose={() => setFullscreenUrl(null)} />}

      {/* Left: full-bleed cinematic scene */}
      <div
        key={idx}
        className="relative flex-1 min-w-0 animate-in fade-in zoom-in-95 duration-700 overflow-hidden cursor-zoom-in"
        onClick={() => {
          setFullscreenUrl(imageUrl ?? defaultImageUrl); setPlaying(false);
        }}
      >
        <SceneBackground imageUrl={imageUrl} defaultImageUrl={defaultImageUrl} />

        {/* Narration card - centered vertically */}
        <div
          className="absolute inset-0 flex items-center justify-center p-6 z-10"
          onClick={e => e.stopPropagation()}
        >
          <div
            key={`n-${idx}`}
            className="backdrop-blur-md bg-slate-950/70 rounded-[24px] p-6 md:p-8 w-full max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300"
          >
            <p className="font-narrative text-slate-100 italic leading-relaxed text-xl md:text-2xl lg:text-3xl">
              {turn.narration}
            </p>
            <div className="mt-4">
              <NarrationTtsButton text={turn.narration} ttsSettings={ttsSettings} hasTts={hasTts} turnId={turn.id} />
            </div>
          </div>
        </div>

        {/* Progress bar overlay - centered at bottom of scene */}
        <div
          className="absolute bottom-0 left-0 right-0 pb-4 z-20 flex justify-center"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex gap-1 flex-wrap justify-center px-6 max-w-xl">
            {history.map((_, i) => (
              <button
                key={i}
                onClick={() => {
                  setIdx(i); setPlaying(false);
                }}
                className={`h-1.5 rounded-full transition-all ${i === idx ? 'bg-amber-500 w-6' : i < idx ? 'bg-slate-500/70 w-1.5' : 'bg-slate-700/70 w-1.5'}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right: wider info panel with character + roll + action + nav controls */}
      <div
        key={`info-${idx}`}
        className="w-[28rem] xl:w-[32rem] flex-shrink-0 flex flex-col gap-3 p-5 bg-slate-950/80 border-l border-slate-800 overflow-y-auto animate-in fade-in slide-in-from-right-4 duration-500"
        onClick={e => e.stopPropagation()}
      >
        {/* Actor */}
        {actor && (
          <div className="flex items-center gap-3 p-4 bg-slate-900/60 rounded-2xl border border-slate-800">
            <img src={imgSrc(actor.avatarUrl)} className="w-16 h-16 rounded-full object-cover border-2 border-slate-600 flex-shrink-0" alt={actor.name} />
            <div className="min-w-0">
              <div className="font-black text-base uppercase tracking-wide text-slate-200 truncate">{actor.name}</div>
              <div className="text-xs text-slate-500 uppercase tracking-wide">{actor.class}</div>
            </div>
          </div>
        )}

        {/* Chosen action */}
        {turn.lastAction && (() => {
          const statUsed = turn.lastAction.actionResult.statUsed;
          const statColors = STAT_COLORS[statUsed] ?? STAT_COLORS.none;
          return (
            <div className={`p-4 rounded-2xl border-2 ${statColors}`}>
              <div className="text-base font-black uppercase tracking-widest text-amber-400 mb-2">Chosen Action</div>
              {statUsed !== 'none' && (
                <div className="flex items-center gap-3 mb-3">
                  <StatImg stat={statUsed} size="16" rounded />
                  <span className="text-xl font-black uppercase tracking-widest">
                    {statUsed}
                  </span>
                </div>
              )}
              <p className="font-narrative italic text-slate-100 text-xl leading-snug">
                "{turn.lastAction.actionAttempt}"
              </p>
            </div>
          );
        })()}

        {/* Roll result */}
        {hasRoll && (
          <div className="p-4 bg-slate-900/60 rounded-2xl border border-slate-800 flex flex-col items-center gap-3">
            <D20 roll={roll.roll} success={roll.success} size={72} />
            <span className={`text-sm font-black uppercase tracking-widest ${roll.success ? 'text-amber-500' : 'text-rose-400'}`}>
              {roll.success ? 'Success' : 'Failed'}
            </span>
            <RollBreakdown
              roll={roll.roll}
              statBonus={roll.statBonus}
              itemBonus={roll.itemBonus}
              success={roll.success}
              difficultyTarget={roll.difficultyTarget}
              className="text-xl"
              iconSize="10"
            />
          </div>
        )}

        {/* Nav controls pinned at bottom */}
        <div className="mt-auto flex flex-col gap-3 pt-2">
          <div className="text-center text-[9px] font-black uppercase tracking-widest text-slate-700">
            Turn {idx + 1} / {history.length}
          </div>
          <div className="flex items-center gap-2 justify-center">
            <button
              onClick={() => {
                setIdx(i => Math.max(0, i - 1));
                setPlaying(false);
              }}
              disabled={idx === 0}
              className="px-5 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl font-black text-base disabled:opacity-30 transition-colors flex flex-col items-center leading-none gap-0.5"
            >
              <span>←</span>
              <span className="text-[8px] text-slate-500 font-normal normal-case tracking-normal">arrow</span>
            </button>
            <button
              onClick={() => setPlaying(p => !p)}
              className="px-6 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl font-black text-base flex flex-col items-center leading-none gap-0.5 transition-colors"
            >
              <span>{playing ? 'Pause' : 'Play'}</span>
              <span className="text-[8px] text-slate-500 font-normal normal-case tracking-normal">space</span>
            </button>
            <button
              onClick={() => {
                setIdx(i => Math.min(history.length - 1, i + 1));
                setPlaying(false);
              }}
              disabled={isLast}
              className="px-5 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl font-black text-base disabled:opacity-30 transition-colors flex flex-col items-center leading-none gap-0.5"
            >
              <span>→</span>
              <span className="text-[8px] text-slate-500 font-normal normal-case tracking-normal">arrow</span>
            </button>
          </div>
          {isLast && (
            <button onClick={onEnter} className="w-full py-3 bg-amber-600 hover:bg-amber-500 rounded-xl font-black uppercase italic tracking-tighter text-base shadow-[0_4px_0_rgb(146,64,14)] transition-all">
              Enter Realm →
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── PAGE ─────────────────────────────────────────────────────────────────────

export const SessionRecap = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('choose');
  const [session, setSession] = useState<Session | null>(null);
  const [history, setHistory] = useState<TurnResult[]>([]);
  const [showKeybindingsHelp, setShowKeybindingsHelp] = useState(false);
  const { capabilities } = useCapabilities();

  const enter = useCallback(() => navigate(`/session/${id}`), [id, navigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?') {
        setShowKeybindingsHelp(h => !h);
        return;
      }
      if (mode !== 'choose') {
        return;
      }
      if (e.key === '1') {
        setMode('tldr');
      } else if (e.key === '2') {
        setMode('movie');
      } else if (e.key === '3') {
        enter();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, enter]);

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

  useEffect(() => {
    if (!id) {
      return;
    }
    Promise.all([
      apiFetch(`/session/${id}`).then(r => r.json()),
      apiFetch(`/session/${id}/history`).then(r => r.json()),
    ]).then(([s, h]) => {
      setSession(s);
      setHistory(h);
      if (!h.length) {
        enter();
      }
    });
  }, [id, enter]);

  useEffect(() => {
    if (session && history.length > 0) {
      audioManager.startAmbientMusic();
    }
  }, [session, history.length]);

  if (!session) {
    return <PageLoader />;
  }

  return (
    <div className="h-screen bg-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />

      {/* Persistent top bar with session name + controls */}
      <div className="flex items-center justify-between px-4 md:px-8 py-3 border-b border-slate-800 flex-shrink-0 relative z-[10]">
        <h1 className="text-lg md:text-2xl font-display font-black text-amber-500 italic tracking-tight truncate">{session.displayName}</h1>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={toggleSavingsMode}
            className={`px-3 py-1.5 rounded-xl border font-black text-xs tracking-widest uppercase transition-all cursor-pointer ${session.savingsMode ? 'border-amber-500 text-amber-400 bg-amber-500/10' : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-400'}`}
          >
            {session.savingsMode ? '🪙 Saving' : '🖼 Images'}
          </button>
          <button
            onClick={enter}
            className="px-4 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 font-black uppercase text-xs tracking-widest transition-all shadow-[0_3px_0_rgb(146,64,14)]"
          >
            Enter Realm →
          </button>
          <Link
            to="/"
            onClick={() => audioManager.stopMusic()}
            className="px-3 py-1.5 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 uppercase font-black text-xs tracking-widest transition-all"
          >
            Exit
          </Link>
        </div>
      </div>

      {/* Mode chooser or content */}
      <div className="flex-1 flex flex-col min-h-0 relative">
        {mode === 'choose' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 animate-in fade-in zoom-in duration-500 relative z-[10] px-4">
            <p className="text-lg md:text-2xl font-black uppercase tracking-widest text-amber-400">How would you like to catch up?</p>
            <div className="flex gap-4 md:gap-6">
              <button onClick={() => setMode('tldr')} className="relative flex flex-col items-center gap-3 p-6 md:p-8 bg-slate-900 hover:bg-slate-800 rounded-[32px] border border-slate-700 hover:border-amber-500/50 transition-all w-36 md:w-44">
                <span className="absolute top-2 right-3 text-[9px] font-black text-slate-600 tracking-widest">[1]</span>
                <img src={imgSrc('/images/icon_scroll.png')} alt="scroll" className="w-12 h-12 object-contain mix-blend-screen" />
                <span className="font-black uppercase tracking-widest text-sm">TLDR</span>
                <span className="text-xs text-slate-500 text-center">AI summary of the adventure</span>
              </button>
              <button onClick={() => setMode('movie')} className="relative flex flex-col items-center gap-3 p-6 md:p-8 bg-slate-900 hover:bg-slate-800 rounded-[32px] border border-slate-700 hover:border-amber-500/50 transition-all w-36 md:w-44">
                <span className="absolute top-2 right-3 text-[9px] font-black text-slate-600 tracking-widest">[2]</span>
                <span className="text-4xl">🎬</span>
                <span className="font-black uppercase tracking-widest text-sm">Movie</span>
                <span className="text-xs text-slate-500 text-center">Relive each turn with scenes</span>
              </button>
            </div>
            <button onClick={enter} className="relative text-slate-500 hover:text-slate-300 font-black uppercase text-xs tracking-widest transition-colors">
              <span className="absolute -top-1 -right-5 text-[9px] font-black text-slate-700 tracking-widest">[3]</span>
              Skip - Jump straight in
            </button>
          </div>
        )}

        {mode === 'tldr' && <TldrView sessionId={id!} onEnter={enter} hasTts={capabilities.hasTts} />}
        {mode === 'movie' && history.length > 0 && <MovieView history={history} party={session.party} onEnter={enter} hasTts={capabilities.hasTts} />}
      </div>

      <DmFooter />
      {showKeybindingsHelp && (
        <KeybindingsHelp
          onClose={() => setShowKeybindingsHelp(false)}
          bindings={mode === 'movie' ? [
            { key: 'Space', action: 'Play / Pause' },
            { key: '← →', action: 'Previous / Next scene' },
            { key: '?', action: 'Toggle this help' },
          ] : mode === 'choose' ? [
            { key: '1', action: 'TLDR summary' },
            { key: '2', action: 'Movie mode' },
            { key: '3', action: 'Skip - Enter realm directly' },
            { key: '?', action: 'Toggle this help' },
          ] : [
            { key: '?', action: 'Toggle this help' },
          ]}
        />
      )}
    </div>
  );
};
