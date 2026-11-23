import { useLocation } from 'react-router-dom';
import { useSoundOptIn } from '../audio/useSoundOptIn';

// Sign-in and TV pairing pages play no audio, so they get no chip.
const QUIET_PATHS = ['/login', '/verify-email', '/namespace-picker', '/request-invite', '/accept-invite', '/tv', '/link'];

// Opt-in sound: a small chip instead of a blocking prompt. Hidden once sound is on.
// Car mode shows its own button in place of its header badge.
export const SoundChip = () => {
  const { pathname } = useLocation();
  const { needed, icon, label, enable } = useSoundOptIn();

  if (!needed || QUIET_PATHS.includes(pathname) || pathname.endsWith('/car')) {
    return null;
  }

  // Phones: icon only, bottom right above the adventure screen's tool bar, clear of the title.
  return (
    <button
      type="button"
      onClick={enable}
      aria-label={label}
      className="fixed bottom-24 right-4 sm:bottom-auto sm:right-auto sm:top-3 sm:left-1/2 sm:-translate-x-1/2 z-[85] flex items-center gap-2 w-11 h-11 sm:w-auto sm:h-auto justify-center sm:px-3 sm:py-1.5 rounded-full border border-slate-700 bg-slate-900/90 backdrop-blur-sm text-xs font-black uppercase tracking-widest whitespace-nowrap text-slate-300 hover:border-amber-500/60 hover:text-amber-200 transition-colors"
    >
      <span aria-hidden="true" className="text-base sm:text-xs">{icon}</span>
      <span aria-hidden="true" className="hidden sm:inline">{label}</span>
    </button>
  );
};
