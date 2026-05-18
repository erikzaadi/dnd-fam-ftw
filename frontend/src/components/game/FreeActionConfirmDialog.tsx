import { useState, useEffect, useRef } from 'react';
import type { FreeActionPreview } from '../../types';
import { StatImg } from './StatIcon';
import { STAT_TEXT_COLORS } from '../../lib/statColors';
import { beatTarget } from '../../lib/game';
import {
  formatHelperBonusLabel,
  formatChoiceItemBonusLabel,
  formatCharacterBonusLabel,
} from './rollBonusLabels';

const RISK_MAP: Record<string, { label: string; color: string }> = {
  easy: { label: 'Favorable', color: 'text-emerald-400' },
  normal: { label: 'Risky', color: 'text-amber-400' },
  hard: { label: 'Tough', color: 'text-rose-400' },
};

type FreeActionConfirmDialogProps = {
  preview: FreeActionPreview | null;
  statBonus: number;
  submitting: boolean;
  showOriginalAction?: boolean;
  onConfirm: (useOriginalAction?: boolean) => void;
  onEdit: () => void;
  onCancel: () => void;
};

export const FreeActionConfirmDialog = ({
  preview,
  statBonus,
  submitting,
  showOriginalAction = false,
  onConfirm,
  onEdit,
  onCancel,
}: FreeActionConfirmDialogProps) => {
  const [useOriginalAction, setUseOriginalAction] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (preview) {
      confirmButtonRef.current?.focus();
    }
  }, [preview]);

  if (!preview) {
    return null;
  }

  const risk = RISK_MAP[preview.difficulty] ?? RISK_MAP.normal;
  const target = beatTarget(preview.difficultyValue, preview.difficulty);
  const bonusTotal =
    (preview.helperBonus ?? 0) +
    (preview.choiceItemBonus ?? 0) +
    (preview.characterBonus ?? 0);
  const statTotal = statBonus + bonusTotal;
  const warnings = preview.warnings ?? [];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border-2 border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="text-xs font-black uppercase tracking-widest text-slate-500">Custom Action</div>
        <div className="mt-2 text-lg font-black text-white leading-tight">
          Confirm your action
        </div>

        <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
          <div className="text-xs font-black uppercase tracking-widest text-amber-400 mb-2">Action the game will use</div>
          <p className="text-sm leading-relaxed text-slate-200">{preview.interpretedAction}</p>
          {preview.narration && (
            <p className="text-xs italic text-slate-300/70 mt-1.5 leading-snug">{preview.narration}</p>
          )}
        </div>

        {showOriginalAction && (
          <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <div className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">What you originally typed</div>
            <textarea
              readOnly
              value={preview.originalAction}
              className="h-16 w-full resize-none rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm leading-relaxed text-slate-300 outline-none"
            />
            <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
              <span className="text-xs font-black uppercase tracking-widest text-slate-400">Force original text</span>
              <input
                type="checkbox"
                checked={useOriginalAction}
                onChange={e => setUseOriginalAction(e.target.checked)}
                className="h-4 w-4 accent-amber-500"
              />
            </label>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
          <StatImg stat={preview.stat} size="4" tooltip className="rounded-xl" />
          <span className={`text-sm font-black ${STAT_TEXT_COLORS[preview.stat] ?? 'text-slate-300'}`}>
            {preview.stat}
          </span>
          <span className="text-sm font-black text-slate-400">
            {statTotal} vs {target}
          </span>
          <span className={`text-xs font-semibold uppercase tracking-wider ${risk.color}`}>
            {risk.label}
          </span>
        </div>

        {bonusTotal > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 px-1">
            {(preview.helperBonus ?? 0) > 0 && (
              <span className="text-xs font-black text-cyan-300">
                +{formatHelperBonusLabel(preview.helperBonus!, preview.helperCharacterName)}
              </span>
            )}
            {(preview.choiceItemBonus ?? 0) > 0 && (
              <span className="text-xs font-black text-amber-300">
                +{formatChoiceItemBonusLabel(preview.choiceItemBonus!, preview.choiceItemName)}
              </span>
            )}
            {(preview.characterBonus ?? 0) > 0 && (
              <span className="text-xs font-black text-fuchsia-300">
                +{formatCharacterBonusLabel(preview.characterBonus!, preview.characterBonusLabel)}
              </span>
            )}
          </div>
        )}

        {preview.weakPointMatch && (
          <div className="mt-3 rounded-xl border border-amber-600/40 bg-amber-950/20 px-3 py-2">
            <p className="text-xs font-black text-amber-300">
              {preview.weakPointMatch.description}
            </p>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-700/40 bg-amber-950/30 px-3 py-2">
            {warnings.map((w: string, i: number) => (
              <p key={i} className="text-xs text-amber-300">{w}</p>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            ref={confirmButtonRef}
            onClick={() => onConfirm(showOriginalAction && useOriginalAction)}
            disabled={submitting}
            className="flex-1 py-3 rounded-2xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 font-black uppercase tracking-widest text-sm transition-colors"
          >
            {submitting ? 'Submitting...' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={onEdit}
            disabled={submitting}
            className="flex-1 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 font-black uppercase tracking-widest text-sm transition-colors"
          >
            Edit
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
