import { useEffect, useRef } from 'react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
}

export const ConfirmDialog = ({ message, onConfirm, onCancel, confirmLabel = 'Confirm' }: ConfirmDialogProps) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'h' || e.key === 'l') {
      e.preventDefault();
      if (document.activeElement === cancelRef.current) {
        confirmRef.current?.focus();
      } else {
        cancelRef.current?.focus();
      }
    }
  };

  return (
    <Modal zIndex={300}>
      <div className="bg-slate-900 p-8 rounded-3xl border border-slate-700 max-w-sm w-full shadow-2xl">
        <p className="text-white text-lg font-medium mb-6">{message}</p>
        <div className="flex gap-4" onKeyDown={handleKeyDown}>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 focus:ring-2 focus:ring-rose-400 focus:outline-none rounded-xl font-black uppercase text-xs"
          >
            {confirmLabel}
          </button>
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 focus:ring-2 focus:ring-slate-400 focus:outline-none rounded-xl font-black uppercase text-xs"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
};
