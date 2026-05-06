import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { DmFooter } from '../components/DmFooter';
import { SiteHeader } from '../components/SiteHeader';
import { apiFetch, imgSrc } from '../lib/api';

const CONCEPTS = [
  {
    icon: '📖',
    title: 'The Story Box',
    desc: 'Your DM narrates what happens in the world. Read it - it reacts to every choice you make.',
  },
  {
    icon: '⚔',
    title: 'The Party Box',
    desc: 'Your heroes, their HP, stats, and items at a glance. Tap any hero to see their full details.',
  },
  {
    icon: '🎯',
    title: 'The Action Dock',
    desc: 'Pick a suggested action or type anything you want. "I bribe the guard with cheese" is a valid action.',
  },
  {
    icon: '🎲',
    title: 'The Roll',
    desc: 'Your hero rolls a d20 + their stat bonus. High enough = success. Too low = consequences. Always drama.',
  },
];

export const GetMeRollin = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    const res = await apiFetch('/session/quick-start', { method: 'POST' });
    const data = await res.json() as { id?: string; error?: string; message?: string };
    setLoading(false);
    if (res.status === 403 && data.error === 'session_limit') {
      setError(data.message ?? 'Session limit reached for this group.');
      return;
    }
    if (!res.ok || !data.id) {
      setError('Something went wrong. Try again in a moment.');
      return;
    }
    localStorage.setItem('onboarding_tutorial_step', '1');
    navigate(`/session/${data.id}`);
  };

  return (
    <div className="h-[100dvh] bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 text-white flex flex-col overflow-hidden">
      <SiteHeader />

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="flex flex-col gap-6 px-4 md:px-8 pt-6 pb-8 max-w-2xl mx-auto">

          {/* Hero blurb */}
          <div className="text-center space-y-4">
            <h2 className="text-4xl md:text-5xl font-black uppercase italic tracking-tighter text-amber-400">Get Me Rollin'</h2>
            <p className="text-slate-300 text-base md:text-lg leading-relaxed max-w-lg mx-auto">
              You command a party of four heroes, each with three stats:
            </p>
            <div className="flex justify-center gap-4 md:gap-8 flex-wrap">
              <div className="flex flex-col items-center gap-1">
                <img src={imgSrc('/images/icon_might.png')} className="w-10 h-10 rounded-xl object-cover" alt="" />
                <span className="text-amber-300 font-black text-base md:text-lg uppercase tracking-wide">Might</span>
                <span className="text-slate-400 text-sm">strength</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <img src={imgSrc('/images/icon_magic.png')} className="w-10 h-10 rounded-xl object-cover" alt="" />
                <span className="text-purple-300 font-black text-base md:text-lg uppercase tracking-wide">Magic</span>
                <span className="text-slate-400 text-sm">spells & smarts</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <img src={imgSrc('/images/icon_mischief.png')} className="w-10 h-10 rounded-xl object-cover" alt="" />
                <span className="text-green-300 font-black text-base md:text-lg uppercase tracking-wide">Mischief</span>
                <span className="text-slate-400 text-sm">speed & cunning</span>
              </div>
            </div>
            <p className="text-slate-300 text-base md:text-lg leading-relaxed max-w-lg mx-auto">
              Each turn you pick an action - or type your own - and one hero attempts it. A d20 roll plus their stat bonus decides success or failure. When all heroes fall, the campaign ends.
            </p>
          </div>

          {/* Concept cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CONCEPTS.map(c => (
              <div key={c.title} className="bg-black/40 border border-slate-800 rounded-2xl px-4 py-4 flex gap-3 items-start">
                <span className="text-2xl flex-shrink-0 mt-0.5">{c.icon}</span>
                <div>
                  <p className="text-sm font-black uppercase tracking-widest text-amber-400 mb-1">{c.title}</p>
                  <p className="text-base text-slate-400 leading-relaxed">{c.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Links */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-6 justify-center text-center">
            <p className="text-base text-slate-500">
              Want the full rules?{' '}
              <Link to="/how-to-play" className="text-amber-400 hover:text-amber-300 font-bold underline-offset-2 underline transition-colors">
                How to Play
              </Link>
            </p>
            <p className="text-base text-slate-500">
              Adjust voices and music in{' '}
              <Link to="/settings" className="text-amber-400 hover:text-amber-300 font-bold underline-offset-2 underline transition-colors">
                Settings
              </Link>
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center justify-between gap-4 px-6 py-3 bg-rose-950/60 border border-rose-700 rounded-2xl text-rose-300 text-sm">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-200 font-black">✕</button>
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleStart}
            disabled={loading}
            className="w-full py-7 bg-amber-600 hover:bg-amber-500 disabled:opacity-60 rounded-[32px] shadow-[0_10px_0_rgb(146,64,14)] transition-all uppercase italic tracking-tighter font-black text-2xl md:text-3xl flex items-center justify-center gap-3"
          >
            <img
              src={imgSrc('/images/icon_dice.png')}
              className={`rounded-full object-cover flex-shrink-0 transition-all duration-300 ${loading ? 'w-14 h-14 animate-dice-spin' : 'w-10 h-10 animate-dice-shake'}`}
              alt=""
            />
            {loading ? "They see me rollin', they waitin'..." : "Let's Roll!"}
          </button>

        </div>
      </div>

      <DmFooter />
    </div>
  );
};
