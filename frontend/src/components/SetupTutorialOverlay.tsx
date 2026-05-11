import { type CSSProperties, useEffect, useState } from 'react';
import type { SetupTutorialStep } from '../hooks/useSetupTutorial';

function useElementRect(selector: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!selector) {
      return;
    }
    const update = () => {
      const el = document.querySelector(selector);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [selector]);

  return rect;
}

function styleForRect(rect: DOMRect | null, placement: SetupTutorialStep['placement']): CSSProperties {
  if (!rect) {
    return { left: 16, right: 16, bottom: 16 };
  }
  const centerX = Math.min(window.innerWidth - 208, Math.max(208, rect.left + rect.width / 2));
  const centerY = Math.min(window.innerHeight - 120, Math.max(120, rect.top + rect.height / 2));
  if (placement === 'top') {
    return { left: centerX, top: Math.max(16, rect.top - 12), transform: 'translate(-50%, -100%)' };
  }
  if (placement === 'left') {
    return { left: Math.max(16, rect.left - 12), top: centerY, transform: 'translate(-100%, -50%)' };
  }
  if (placement === 'right') {
    return { left: Math.min(window.innerWidth - 16, rect.right + 12), top: centerY, transform: 'translateY(-50%)' };
  }
  return { left: centerX, top: Math.min(window.innerHeight - 16, rect.bottom + 12), transform: 'translateX(-50%)' };
}

export const SetupTutorialOverlay = ({
  step,
  stepNumber,
  totalSteps,
  onAdvance,
  onDismiss,
}: {
  step: SetupTutorialStep | null;
  stepNumber: number;
  totalSteps: number;
  onAdvance: () => void;
  onDismiss: () => void;
}) => {
  const rect = useElementRect(step?.selector ?? null);

  if (!step) {
    return null;
  }

  const isLast = stepNumber >= totalSteps;
  return (
    <div className="fixed z-[260] pointer-events-none max-w-sm w-[calc(100vw-2rem)]" style={styleForRect(rect, step.placement)}>
      <div className="pointer-events-auto rounded-2xl border border-amber-600/40 bg-slate-900/95 p-4 shadow-2xl shadow-black/60 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{stepNumber} / {totalSteps}</p>
            <p className="text-sm font-black uppercase tracking-[0.16em] text-amber-400">{step.title}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg px-2 py-1 text-xs font-black text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
            aria-label="Dismiss setup tutorial"
          >
            X
          </button>
        </div>
        <p className="text-sm leading-relaxed text-slate-300">{step.body}</p>
        <button
          type="button"
          onClick={onAdvance}
          className="mt-4 rounded-xl bg-amber-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-amber-500"
        >
          {isLast ? 'Done' : 'Next'}
        </button>
      </div>
    </div>
  );
};
