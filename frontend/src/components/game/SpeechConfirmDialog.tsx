import type { SpeechIntent } from '../../stt/speechIntent';
import type { TurnResult } from '../../types';

type SpeechConfirmDialogProps = {
  intent: SpeechIntent | null;
  turn: TurnResult | null;
  submitting: boolean;
  onConfirm: () => void;
  onRetry: () => void;
  onCancel: () => void;
};

export const SpeechConfirmDialog = ({
  intent,
  turn,
  submitting,
  onConfirm,
  onRetry,
  onCancel,
}: SpeechConfirmDialogProps) => {
  if (!intent) {
    return null;
  }

  const choice = intent.type === 'choice' ? turn?.choices[intent.index] : null;
  const preview = intent.type === 'choice'
    ? choice
      ? `Action ${intent.index + 1}: ${choice.label}`
      : `Action ${intent.index + 1}`
    : intent.text;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border-2 border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="text-xs font-black uppercase tracking-widest text-slate-500">Voice Action</div>
        <div className="mt-2 text-lg font-black text-white leading-tight">
          Confirm what you said
        </div>
        <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-slate-200">
          <div className="text-xs font-black uppercase tracking-widest text-amber-400 mb-2">
            {intent.type === 'choice' ? 'Suggested action' : 'Custom action'}
          </div>
          <p className="text-sm leading-relaxed">{preview}</p>
        </div>
        <div className="mt-5 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="flex-1 py-3 rounded-2xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 font-black uppercase tracking-widest text-sm transition-colors"
          >
            {submitting ? 'Submitting...' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={onRetry}
            disabled={submitting}
            className="flex-1 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 font-black uppercase tracking-widest text-sm transition-colors"
          >
            Re-say
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 py-3 rounded-2xl bg-rose-950/40 hover:bg-rose-900/50 disabled:opacity-40 border border-rose-800/60 text-rose-200 font-black uppercase tracking-widest text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

