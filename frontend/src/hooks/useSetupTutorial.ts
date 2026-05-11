import { useCallback, useState } from 'react';

export const CHARACTER_ASSEMBLY_TUTORIAL_KEY = 'character_assembly_tutorial_done';
export const NEW_SESSION_TUTORIAL_KEY = 'new_session_tutorial_done';
export const HOME_TUTORIAL_KEY = 'home_tutorial_done';
export const HOME_TUTORIAL_PENDING_KEY = 'home_tutorial_pending';

export type SetupTutorialStep = {
  id: string;
  selector: string;
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
};

export function resetSetupTutorials() {
  localStorage.removeItem(HOME_TUTORIAL_KEY);
  localStorage.setItem(HOME_TUTORIAL_PENDING_KEY, '1');
  localStorage.removeItem(CHARACTER_ASSEMBLY_TUTORIAL_KEY);
  localStorage.removeItem(NEW_SESSION_TUTORIAL_KEY);
}

export function useSetupTutorial(storageKey: string, steps: SetupTutorialStep[], onFinish?: () => void) {
  const [index, setIndex] = useState(() => localStorage.getItem(storageKey) ? null : 0);

  const dismiss = useCallback(() => {
    localStorage.setItem(storageKey, '1');
    onFinish?.();
    setIndex(null);
  }, [onFinish, storageKey]);

  const advance = useCallback(() => {
    setIndex(current => {
      if (current === null) {
        return null;
      }
      const next = current + 1;
      if (next >= steps.length) {
        localStorage.setItem(storageKey, '1');
        onFinish?.();
        return null;
      }
      return next;
    });
  }, [onFinish, steps.length, storageKey]);

  return {
    step: index === null ? null : steps[index] ?? null,
    stepNumber: index === null ? 0 : index + 1,
    totalSteps: steps.length,
    advance,
    dismiss,
  };
}
