import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Session, Character } from '../../types';
import type { AudioSettings } from '../../audio/audioTypes';
import { PartyBox } from '../PartyBox';
import { audioManager } from '../../audio/audioManager';
import { browserTtsService } from '../../tts/browserTtsService';

interface GearPopoverProps {
  savingsMode: boolean;
  onToggleSavingsMode: () => void;
  audioSettings: AudioSettings;
  onMuteToggle: () => void;
}

const GearPopover = ({ savingsMode, onToggleSavingsMode, audioSettings, onMuteToggle }: GearPopoverProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      const first = menuRef.current?.querySelector<HTMLElement>('button, a');
      first?.focus();
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inTextField = (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT';
      if (inTextField) {
        return;
      }
      if (e.key === 's') {
        setOpen(o => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('button, a') ?? []);
      const currentIdx = items.findIndex(el => el === document.activeElement);
      items[Math.min(items.length - 1, currentIdx + 1)]?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('button, a') ?? []);
      const currentIdx = items.findIndex(el => el === document.activeElement);
      items[Math.max(0, currentIdx - 1)]?.focus();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showMute = audioSettings.enabled;
  const showSkip = audioSettings.enabled && audioSettings.musicEnabled;

  return (
    <div ref={ref} className="relative group">
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-9 h-9 xl:w-11 xl:h-11 flex items-center justify-center rounded-xl border text-base xl:text-lg transition-all ${open ? 'border-amber-500/60 bg-amber-500/10 text-amber-400' : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'}`}
      >
        ⚙
      </button>
      {!open && (
        <div className="fixed top-[60px] right-4 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-[200]">
          Settings [s]
          <div className="absolute bottom-full right-3 border-4 border-transparent border-b-slate-700" />
        </div>
      )}
      {open && (
        <div ref={menuRef} onKeyDown={handleMenuKeyDown} className="fixed top-[60px] right-4 w-52 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-3 flex flex-col gap-1 z-[200] animate-in fade-in zoom-in-95 duration-150">
          <button
            onClick={() => {
              onToggleSavingsMode();
              setOpen(false);
            }}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${savingsMode ? 'bg-amber-500/10 text-amber-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
          >
            <span className="text-base">{savingsMode ? '🪙' : '🖼'}</span>
            {savingsMode ? 'Images off' : 'Images on'}
          </button>
          {showMute && (
            <button
              onClick={() => {
                onMuteToggle();
                if (!audioSettings.masterMuted) {
                  browserTtsService.stop();
                }
                setOpen(false);
              }}
              className={`flex items-center gap-3 w-full px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${audioSettings.masterMuted ? 'bg-amber-500/10 text-amber-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
            >
              <span className="text-base">{audioSettings.masterMuted ? '🔇' : '🔊'}</span>
              {audioSettings.masterMuted ? 'Unmute' : 'Mute all'}
            </button>
          )}
          {showSkip && (
            <button
              onClick={() => {
                audioManager.skipTrack();
                setOpen(false);
              }}
              className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-all"
            >
              <span className="text-base">⏭</span>
              Skip track
            </button>
          )}
          <div className="border-t border-slate-800 mt-1 pt-1">
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-all"
            >
              <span className="text-base">⚙</span>
              All settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

interface SessionHudProps {
  session: Session;
  onCharacterClick: (c: Character) => void;
  savingsMode: boolean;
  onToggleSavingsMode: () => void;
  audioSettings: AudioSettings;
  onMuteToggle: () => void;
  onExitClick: () => void;
}

export const SessionHud = ({
  session,
  onCharacterClick,
  savingsMode,
  onToggleSavingsMode,
  audioSettings,
  onMuteToggle,
  onExitClick,
}: SessionHudProps) => (
  <header className="sticky top-0 z-[60] flex-shrink-0 flex justify-between items-center gap-4 px-4 py-3 border-b border-white/10 bg-slate-950/90 backdrop-blur-sm">
    <div className="flex items-center gap-3 md:gap-5 min-w-0 flex-1">
      <h1 className="text-amber-500 text-lg md:text-2xl xl:text-3xl font-display font-black italic tracking-tight truncate min-w-[80px]">
        {session.displayName}
      </h1>
      <PartyBox
        party={session.party}
        activeCharacterId={session.activeCharacterId}
        onCharacterClick={onCharacterClick}
      />
    </div>

    <div className="flex items-center gap-2 shrink-0">
      <GearPopover
        savingsMode={savingsMode}
        onToggleSavingsMode={onToggleSavingsMode}
        audioSettings={audioSettings}
        onMuteToggle={onMuteToggle}
      />

      {/* Exit */}
      <div className="relative group">
        <button
          onClick={onExitClick}
          className="w-9 h-9 xl:w-11 xl:h-11 flex items-center justify-center rounded-xl border border-rose-900/60 text-rose-500 hover:bg-rose-900/20 hover:border-rose-700 hover:text-rose-300 font-black text-sm xl:text-base transition-all"
        >
          ✕
        </button>
        <div className="absolute top-full right-0 mt-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
          Exit realm [q]
          <div className="absolute bottom-full right-3 border-4 border-transparent border-b-slate-700" />
        </div>
      </div>
    </div>
  </header>
);
