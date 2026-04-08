interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog = ({ message, onConfirm, onCancel }: ConfirmDialogProps) => (
  <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4">
    <div className="bg-slate-900 p-8 rounded-3xl border border-slate-700 max-w-sm w-full shadow-2xl">
      <p className="text-white text-lg font-medium mb-6">{message}</p>
      <div className="flex gap-4">
        <button onClick={onConfirm} className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 rounded-xl font-black uppercase text-xs">Yes, Destroy</button>
        <button onClick={onCancel} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl font-black uppercase text-xs">Cancel</button>
      </div>
    </div>
  </div>
);
