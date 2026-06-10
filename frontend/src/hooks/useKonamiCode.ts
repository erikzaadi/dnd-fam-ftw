import { useEffect, useRef } from 'react';

// Up Up Down Down Left Right Left Right B A
const KONAMI_SEQUENCE = [
  'ArrowUp', 'ArrowUp',
  'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight',
  'ArrowLeft', 'ArrowRight',
  'b', 'a',
];

// Fires onUnlock when the Konami code is typed outside of text fields.
// Intentionally undocumented in the keybindings help: it is an easter egg.
export const useKonamiCode = (onUnlock: () => void): void => {
  const progressRef = useRef(0);
  const unlockRef = useRef(onUnlock);

  useEffect(() => {
    unlockRef.current = onUnlock;
  }, [onUnlock]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
        progressRef.current = 0;
        return;
      }
      if (e.key === KONAMI_SEQUENCE[progressRef.current]) {
        progressRef.current += 1;
        if (progressRef.current === KONAMI_SEQUENCE.length) {
          progressRef.current = 0;
          unlockRef.current();
        }
      } else {
        // A wrong key restarts the hunt; an ArrowUp counts as a fresh attempt
        progressRef.current = e.key === KONAMI_SEQUENCE[0] ? 1 : 0;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
};
