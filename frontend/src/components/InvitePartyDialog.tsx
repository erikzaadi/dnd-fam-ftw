import { useEffect } from 'react';
import { Modal } from './Modal';
import { InvitePartyPanel } from './InvitePartyPanel';

export const InvitePartyDialog = ({ onClose }: { onClose: () => void }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Modal zIndex={300} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Invite your party"
        onClick={e => e.stopPropagation()}
        className="relative bg-slate-900 p-6 md:p-8 rounded-3xl border border-slate-700 max-w-lg w-full shadow-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 rounded-lg px-2 py-1 text-xs font-black text-slate-500 hover:bg-slate-800 hover:text-slate-300"
        >
          X
        </button>
        <InvitePartyPanel autoFocus />
      </div>
    </Modal>
  );
};
