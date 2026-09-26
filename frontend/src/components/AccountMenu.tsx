import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, switchNamespace } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { ConfirmDialog } from './ConfirmDialog';
import type { SessionNamespace, SessionNamespacesResponse } from '../types';

// Pages holding unsaved setup work that a realm switch (a full reload) would discard.
const hasUnsavedWork = (pathname: string) =>
  pathname.startsWith('/create-session') || pathname.startsWith('/session/');

const ITEM = 'flex items-center gap-3 w-full px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-left transition-colors text-slate-300 hover:bg-slate-800 hover:text-white focus:bg-slate-800 focus:text-white focus:outline-none';

export const AccountMenu = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [realms, setRealms] = useState<SessionNamespace[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<SessionNamespace | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/auth/session/namespaces')
      .then(async res => {
        if (res.ok && !cancelled) {
          setRealms((await res.json() as SessionNamespacesResponse).namespaces);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user?.namespaceId]);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) {
      buttonRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        close(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  if (!user) {
    return null;
  }

  const current = realms.find(realm => realm.id === user.namespaceId);
  const others = realms.filter(realm => realm.id !== user.namespaceId);
  // Realm names are not unique; show a short id suffix when two share a name.
  const label = (realm: SessionNamespace) =>
    realms.filter(r => r.name === realm.name).length > 1 ? `${realm.name} (${realm.id.slice(0, 4)})` : realm.name;

  const doSwitch = async (realm: SessionNamespace) => {
    setConfirmTarget(null);
    setSwitching(realm.id);
    setError(null);
    if (!await switchNamespace(realm.id)) {
      setSwitching(null);
      setError('Could not switch realms. Try again.');
    }
  };

  const requestSwitch = (realm: SessionNamespace) => {
    if (hasUnsavedWork(location.pathname)) {
      setOpen(false);
      setConfirmTarget(realm);
      return;
    }
    void doSwitch(realm);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    // The banner behind this opens a fullscreen image on click; keep clicks here.
    <div className="absolute top-3 right-3 z-50" onClick={e => e.stopPropagation()}>
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="text-slate-300 hover:text-white bg-slate-950/60 backdrop-blur-sm rounded-full px-3 h-9 flex items-center gap-1.5 text-xs font-bold transition-colors"
      >
        <span className="hidden sm:inline truncate max-w-[160px]">{current ? label(current) : user.email.split('@')[0]}</span>
        <span aria-hidden>👤</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-2 space-y-1"
        >
          <div className="px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Current realm</div>
            <div className="text-sm font-bold text-amber-400 truncate">{current ? label(current) : '...'}</div>
            <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
          </div>
          {others.length > 0 && (
            <div className="border-t border-slate-800 pt-1">
              <div className="px-3 pt-1 pb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Switch realm</div>
              {others.map(realm => (
                <button
                  key={realm.id}
                  role="menuitem"
                  disabled={switching !== null}
                  onClick={() => requestSwitch(realm)}
                  className={`${ITEM} disabled:opacity-50`}
                >
                  <span aria-hidden>🗺</span>
                  <span className="truncate">{switching === realm.id ? 'Entering...' : label(realm)}</span>
                </button>
              ))}
            </div>
          )}
          {error && <div className="px-3 py-1 text-xs text-rose-300" role="alert">{error}</div>}
          <div className="border-t border-slate-800 pt-1">
            <Link to="/settings" role="menuitem" onClick={() => setOpen(false)} className={ITEM}>
              <span aria-hidden>⚙️</span>Settings
            </Link>
            <button role="menuitem" onClick={() => void handleLogout()} className={ITEM}>
              <span aria-hidden>↩</span>Sign out
            </button>
          </div>
        </div>
      )}
      {confirmTarget && (
        <ConfirmDialog
          message={`Switch to ${label(confirmTarget)}? You will leave this page, and anything not yet saved or sent is lost.`}
          confirmLabel="Switch realm"
          onConfirm={() => void doSwitch(confirmTarget)}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </div>
  );
};
