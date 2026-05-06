import { useState, useCallback } from 'react';

const STORAGE_KEY = 'onboarding_tutorial_step';
const COMPLETE_STEP = 8;

function readStep(): number | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return null;
  }
  const n = parseInt(stored, 10);
  return isNaN(n) || n >= COMPLETE_STEP ? null : n;
}

export function useOnboardingTutorial({
  isLoading,
  lastRollVisible,
}: {
  isLoading: boolean;
  lastRollVisible: boolean;
}) {
  const [step, setStep] = useState<number | null>(readStep);
  // Track previous isLoading value using React's documented prev-props pattern
  // (setState called during render body triggers an immediate synchronous re-render
  // and is explicitly supported by React for this use case).
  const [prevIsLoading, setPrevIsLoading] = useState(isLoading);
  // Guards the 4→5 transition: only advance once the roll popup was actually shown.
  const [rollWasShown, setRollWasShown] = useState(false);

  if (prevIsLoading !== isLoading) {
    setPrevIsLoading(isLoading);
    if (step === 3 && isLoading) {
      localStorage.setItem(STORAGE_KEY, '4');
      setStep(4);
    }
  }

  if (step === 4 && lastRollVisible && !rollWasShown) {
    setRollWasShown(true);
  }

  // step 4→5 is ephemeral: only after the roll was shown, then closed.
  const effectiveStep = step === 4 && rollWasShown && !lastRollVisible ? 5 : step;

  const advance = useCallback(() => {
    if (effectiveStep === null) {
      return;
    }
    const next = effectiveStep + 1;
    if (next >= COMPLETE_STEP) {
      localStorage.removeItem(STORAGE_KEY);
      setStep(null);
    } else {
      localStorage.setItem(STORAGE_KEY, String(next));
      setStep(next);
    }
  }, [effectiveStep]);

  return { step: effectiveStep, advance };
}
