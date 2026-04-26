import { useEffect } from 'react';

export interface Keybinding {
  key: string;
  action: string;
}

interface KeybindingsHelpProps {
  bindings: Keybinding[];
  onClose: () => void;
}

export const KeybindingsHelp = ({ bindings, onClose }: KeybindingsHelpProps) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl min-w-64 animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-amber-400 font-black uppercase tracking-widest text-sm mb-4">Keyboard Shortcuts</h3>
        <div className="flex flex-col gap-2">
          {bindings.map(({ key, action }) => (
            <div key={key} className="flex items-center gap-6 justify-between">
              <kbd className="px-2 py-0.5 bg-slate-800 border border-slate-600 rounded text-xs font-mono text-slate-200 shrink-0">{key}</kbd>
              <span className="text-slate-400 text-sm text-right">{action}</span>
            </div>
          ))}
        </div>
        <p className="text-slate-600 text-xs mt-5 text-center">press ? or Esc to close</p>
      </div>
    </div>
  );
};
