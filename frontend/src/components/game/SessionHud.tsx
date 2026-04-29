import { useState, useRef, useEffect } from 'react';
import type { Session, Character } from '../../types';
import type { AudioSettings } from '../../audio/audioTypes';
import { PartyBox } from '../PartyBox';
import { MenuItem } from '../MenuItem';
import { audioManager } from '../../audio/audioManager';
import { browserTtsService } from '../../tts/browserTtsService';
import { Z } from '../../lib/zIndex';

interface GearPopoverProps {
  savingsMode: boolean;
  onToggleSavingsMode: () => void;
  audioSettings: AudioSettings;
  onMuteToggle: () => void;
}

export const GearPopover = ({ savingsMode, onToggleSavingsMode, audioSettings, onMuteToggle }: GearPopoverProps) => {
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
        <div className={`fixed top-[60px] right-4 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap ${Z.popover}`}>
          Settings [s]
          <div className="absolute bottom-full right-3 border-4 border-transparent border-b-slate-700" />
        </div>
      )}
      {open && (
        <div ref={menuRef} onKeyDown={handleMenuKeyDown} className={`fixed top-[60px] right-4 w-52 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-3 flex flex-col gap-1 ${Z.popover} animate-in fade-in zoom-in-95 duration-150`}>
          <MenuItem
            icon={savingsMode ? '🪙' : '🖼'}
            label={savingsMode ? 'Images off' : 'Images on'}
            active={savingsMode}
            onClick={() => {
              onToggleSavingsMode();
              setOpen(false);
            }}
          />
          {showMute && (
            <MenuItem
              icon={audioSettings.masterMuted ? '🔇' : '🔊'}
              label={audioSettings.masterMuted ? 'Unmute' : 'Mute all'}
              active={audioSettings.masterMuted}
              onClick={() => {
                onMuteToggle();
                if (!audioSettings.masterMuted) {
                  browserTtsService.stop();
                }
                setOpen(false);
              }}
            />
          )}
          {showSkip && (
            <MenuItem
              icon="⏭"
              label="Skip track"
              onClick={() => {
                audioManager.skipTrack();
                setOpen(false);
              }}
            />
          )}
          <div className="border-t border-slate-800 mt-1 pt-1">
            <MenuItem icon="⚙" label="All settings" to="/settings" dimmed onClick={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
};

interface SessionHudProps {
  session: Session;
  onCharacterClick: (c: Character) => void;
}

export const SessionHud = ({ session, onCharacterClick }: SessionHudProps) => (
  <header className={`fixed top-0 left-0 right-0 ${Z.hud} flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3 pointer-events-none`}>
    <h1 className="text-amber-500 text-lg md:text-2xl xl:text-3xl font-display font-black italic tracking-tight shrink-0 bg-slate-950/60 backdrop-blur-md ml-4 px-4 py-2 rounded-2xl pointer-events-auto self-start">
      {session.displayName}
    </h1>
    <div className="pointer-events-auto ml-4 sm:ml-0">
      <PartyBox
        party={session.party}
        activeCharacterId={session.activeCharacterId}
        onCharacterClick={onCharacterClick}
      />
    </div>
  </header>
);
