import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DmFooter } from '../components/DmFooter';
import { SiteHeader } from '../components/SiteHeader';
import { SetupTutorialOverlay } from '../components/SetupTutorialOverlay';
import { loadFirstRunPreferences } from '../firstRun/firstRunPreferences';
import { NEW_SESSION_TUTORIAL_KEY, useSetupTutorial } from '../hooks/useSetupTutorial';
import { apiFetch } from '../lib/api';
import type { GameMode } from '../types';

const DIFFICULTY_INFO: Record<string, { color: string; desc: string }> = {
  easy: { color: 'text-emerald-400', desc: 'Rolls target ~8. Fail = -1 HP. Good for younger players or a chill adventure.' },
  normal: { color: 'text-amber-400', desc: 'Rolls target ~12. Fail = -2 HP. The intended experience.' },
  hard: { color: 'text-rose-400', desc: 'Rolls target ~16. Fail = -3 HP. Punishing. Heroes earn every victory.' },
};

const PACING_INFO: Record<string, string> = {
  cinematic: 'Rich story, world-building, and character moments. Combat is rare and meaningful. Best for long sessions.',
  balanced: 'A mix of story and action. Expect a challenge every 4-5 turns. The default experience.',
  fast: 'High stakes from the start. A fight or challenge appears every 2 turns. Little breathing room.',
  'zug-ma-geddon': 'STRAIGHT TO BATTLE. Every turn is chaos. High tension, always. Not for the faint of heart.',
};

const PACING_OPTIONS: { id: GameMode; icon: string; label: string }[] = [
  { id: 'cinematic', icon: '🎬', label: 'Cinematic' },
  { id: 'balanced', icon: '⚖️', label: 'Balanced' },
  { id: 'fast', icon: '⚡', label: 'Fast' },
  { id: 'zug-ma-geddon', icon: '💀', label: 'ZUG-MA-GEDDON' },
];

export const CreateSession = () => {
  const [worldDescription, setWorldDescription] = useState("");
  const [dmPrep, setDmPrep] = useState("");
  const [showDmPrep, setShowDmPrep] = useState(false);
  const [difficulty, setDifficulty] = useState("normal");
  const [gameMode, setGameMode] = useState<GameMode>(() => loadFirstRunPreferences().preferredGameMode);
  const [showWorldDescription, setShowWorldDescription] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preferredPace = useMemo(() => loadFirstRunPreferences().preferredGameMode, []);
  const tutorial = useSetupTutorial(NEW_SESSION_TUTORIAL_KEY, [
    {
      id: 'difficulty',
      selector: '[data-tutorial="new-session-difficulty"]',
      title: 'Difficulty',
      body: 'Difficulty controls the target number heroes need to beat and how much failed rolls hurt.',
      placement: 'bottom',
    },
    {
      id: 'pacing',
      selector: '[data-tutorial="new-session-pacing"]',
      title: 'Game pacing',
      body: 'Pacing changes how quickly danger appears. Cinematic breathes, fast escalates, and ZUG-MA-GEDDON starts in chaos.',
      placement: 'bottom',
    },
    {
      id: 'realm-description',
      selector: '[data-tutorial="realm-description"]',
      title: 'Realm description',
      body: 'This optional note steers the visible world: forests, castles, candy caves, spooky ruins, or anything else.',
      placement: 'top',
    },
    {
      id: 'dm-prep',
      selector: '[data-tutorial="dm-prep"]',
      title: 'DM prep',
      body: 'Optional hidden notes can guide villains, secrets, clues, and campaign payoffs without showing players everything.',
      placement: 'top',
    },
    {
      id: 'next-button',
      selector: '[data-tutorial="create-session-next"]',
      title: 'Next step',
      body: 'This creates the realm, then sends you to assemble the heroes who will adventure there.',
      placement: 'top',
    },
  ]);
  const navigate = useNavigate();

  const createSession = async () => {
    setIsLoading(true);
    setError(null);
    const res = await apiFetch('/session/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldDescription, difficulty, gameMode, dmPrep: dmPrep || undefined })
    });
    const data = await res.json().catch(() => ({}));
    setIsLoading(false);
    if (res.status === 429) {
      setError(data.message ?? 'The AI is busy, please try again.');
      return;
    }
    if (res.status === 403 && data.error === 'session_limit') {
      setError(data.message ?? 'Session limit reached for this group.');
      return;
    }
    if (!res.ok || !data.id) {
      setError(data.message ?? 'Something went wrong. Try again in a moment.');
      return;
    }
    navigate(`/session/${data.id}/assembly`);
  };

  return (
    <div className="h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />
      <SetupTutorialOverlay
        step={tutorial.step}
        stepNumber={tutorial.stepNumber}
        totalSteps={tutorial.totalSteps}
        onAdvance={tutorial.advance}
        onDismiss={tutorial.dismiss}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 min-h-0">
        <div className="bg-slate-900/80 backdrop-blur-sm p-8 md:p-12 rounded-[60px] border-2 border-slate-800 shadow-2xl max-w-2xl w-full mx-auto text-center space-y-8 relative z-[10]">
          <h3 className="text-4xl font-display font-black uppercase tracking-tighter text-amber-500 italic">New Journey</h3>

          {/* Difficulty */}
          <div data-tutorial="new-session-difficulty" className="flex flex-col gap-3">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Difficulty</span>
            <div className="flex gap-2 justify-center">
              {(['easy', 'normal', 'hard'] as const).map(d => (
                <button key={d} onClick={() => setDifficulty(d)} className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${difficulty === d ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-500'}`}>{d}</button>
              ))}
            </div>
            <div className={`text-xs px-4 py-2.5 bg-black/30 rounded-2xl border border-slate-800 text-left ${DIFFICULTY_INFO[difficulty].color}`}>
              {DIFFICULTY_INFO[difficulty].desc}
            </div>
          </div>

          {/* Game Pacing */}
          <div data-tutorial="new-session-pacing" className="flex flex-col gap-3">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Game Pacing</span>
            <div className="flex flex-wrap gap-2 justify-center">
              {PACING_OPTIONS.map(m => (
                <button
                  key={m.id}
                  onClick={() => setGameMode(m.id as GameMode)}
                  className={`flex flex-col items-center px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${gameMode === m.id ? (m.id === 'zug-ma-geddon' ? 'bg-rose-900/20 border-rose-500 text-rose-400' : 'bg-amber-600/10 border-amber-600 text-amber-500') : 'bg-slate-800/50 border-slate-700 text-slate-500'}`}
                >
                  <span className="text-base mb-0.5">{m.icon}</span>
                  <span>{m.label}</span>
                  {m.id === preferredPace && <span className="mt-1 text-[8px] text-slate-500">wizard pick</span>}
                </button>
              ))}
            </div>
            <div className={`text-xs px-4 py-2.5 rounded-2xl border text-left ${gameMode === 'zug-ma-geddon' ? 'bg-rose-950/20 border-rose-800/40 text-rose-300' : 'bg-black/30 border-slate-800 text-slate-400'}`}>
              {PACING_INFO[gameMode]}
            </div>
          </div>

          <div data-tutorial="realm-description" className="rounded-[28px] border border-slate-800 bg-black/20 p-4 text-left">
            {showWorldDescription ? (
              <textarea
                placeholder="Example: a moonlit candy forest where lost toys guard an ancient gate..."
                value={worldDescription}
                onChange={e => setWorldDescription(e.target.value)}
                className="w-full p-5 bg-black/40 rounded-[24px] border-2 border-slate-800 text-base focus:border-amber-500/50 outline-none resize-none h-36"
              />
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-400">Optional: steer the visible realm. Example: a moonlit candy forest with lost toy guards.</p>
                <button onClick={() => setShowWorldDescription(true)} className="px-5 py-3 bg-slate-800 hover:bg-slate-700 rounded-2xl text-xs font-black uppercase tracking-widest">+ Realm Description</button>
              </div>
            )}
          </div>
          <div data-tutorial="dm-prep" className="rounded-[28px] border border-purple-900/40 bg-purple-950/10 p-4 text-left">
            {showDmPrep ? (
              <textarea
                placeholder="Example: villain wants the moon key, Mira knows the password, reveal the bridge clue before the gate..."
                value={dmPrep}
                onChange={e => setDmPrep(e.target.value)}
                className="w-full p-5 bg-black/40 rounded-[24px] border-2 border-purple-900/40 text-base focus:border-purple-500/50 outline-none resize-none h-32 text-slate-300 placeholder-slate-600"
              />
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-purple-200/70">Optional hidden campaign notes: villains, clues, secrets, recurring NPCs, or promised payoffs.</p>
                <button onClick={() => setShowDmPrep(true)} className="px-5 py-3 bg-slate-800/60 hover:bg-slate-700/60 border border-purple-900/40 hover:border-purple-700/60 rounded-2xl text-xs font-black uppercase tracking-widest text-purple-400 hover:text-purple-300 transition-all">+ DM Prep</button>
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-slate-800 bg-black/30 px-4 py-3 text-sm text-slate-400">
            <span className="font-black uppercase tracking-widest text-amber-400">Selected:</span>{' '}
            {difficulty} difficulty, {PACING_OPTIONS.find(option => option.id === gameMode)?.label ?? gameMode} pacing
          </div>
          {error && (
            <div className="flex items-center justify-between gap-4 px-6 py-3 bg-rose-950/60 border border-rose-700 rounded-2xl text-rose-300 text-sm">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-200 font-black">✕</button>
            </div>
          )}
          <button data-tutorial="create-session-next" onClick={createSession} disabled={isLoading} className="w-full py-8 bg-amber-600 hover:bg-amber-500 rounded-[32px] text-4xl font-black shadow-[0_12px_0_rgb(146,64,14)] transition-all uppercase italic tracking-tighter">
            {isLoading ? 'FORGING...' : 'NEXT: ASSEMBLE HEROES'}
          </button>
        </div>
      </div>
      <DmFooter />
    </div>
  );
};
