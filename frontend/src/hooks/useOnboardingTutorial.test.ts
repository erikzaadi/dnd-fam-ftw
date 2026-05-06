import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useOnboardingTutorial } from './useOnboardingTutorial';

const STORAGE_KEY = 'onboarding_tutorial_step';

const makeLocalStorage = () => {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value; 
    },
    removeItem: (key: string) => {
      delete store[key]; 
    },
    clear: () => {
      for (const k of Object.keys(store)) {
        delete store[k]; 
      } 
    },
  };
};

let ls: ReturnType<typeof makeLocalStorage>;

beforeEach(() => {
  ls = makeLocalStorage();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: ls });
});

describe('useOnboardingTutorial', () => {
  it('returns null step when localStorage key is absent', () => {
    const { result } = renderHook(() => useOnboardingTutorial({ isLoading: false, lastRollVisible: false }));
    expect(result.current.step).toBeNull();
  });

  it('reads initial step from localStorage', () => {
    ls.setItem(STORAGE_KEY, '1');
    const { result } = renderHook(() => useOnboardingTutorial({ isLoading: false, lastRollVisible: false }));
    expect(result.current.step).toBe(1);
  });

  it('advance increments step and writes localStorage', () => {
    ls.setItem(STORAGE_KEY, '1');
    const { result } = renderHook(() => useOnboardingTutorial({ isLoading: false, lastRollVisible: false }));
    act(() => {
      result.current.advance(); 
    });
    expect(result.current.step).toBe(2);
    expect(ls.getItem(STORAGE_KEY)).toBe('2');
  });

  it('persists step 3 to 4 in localStorage when isLoading becomes true', () => {
    ls.setItem(STORAGE_KEY, '3');
    const { rerender } = renderHook(
      (props: { isLoading: boolean; lastRollVisible: boolean }) => useOnboardingTutorial(props),
      { initialProps: { isLoading: false, lastRollVisible: false } },
    );
    rerender({ isLoading: true, lastRollVisible: false });
    expect(ls.getItem(STORAGE_KEY)).toBe('4');
  });

  it('auto-advances step 4 to 5 when the roll popup closes', () => {
    ls.setItem(STORAGE_KEY, '4');
    const { result, rerender } = renderHook(
      (props: { isLoading: boolean; lastRollVisible: boolean }) => useOnboardingTutorial(props),
      { initialProps: { isLoading: false, lastRollVisible: true } },
    );
    expect(result.current.step).toBe(4);

    rerender({ isLoading: false, lastRollVisible: false });
    expect(result.current.step).toBe(5);
  });

  it('clears localStorage when advancing past step 7', () => {
    ls.setItem(STORAGE_KEY, '7');
    const { result } = renderHook(() => useOnboardingTutorial({ isLoading: false, lastRollVisible: false }));
    act(() => {
      result.current.advance(); 
    });
    expect(result.current.step).toBeNull();
    expect(ls.getItem(STORAGE_KEY)).toBeNull();
  });

  it('treats stored value >= 8 as null (already complete)', () => {
    ls.setItem(STORAGE_KEY, '8');
    const { result } = renderHook(() => useOnboardingTutorial({ isLoading: false, lastRollVisible: false }));
    expect(result.current.step).toBeNull();
  });

  it('advance is a no-op when step is null', () => {
    const { result } = renderHook(() => useOnboardingTutorial({ isLoading: false, lastRollVisible: false }));
    act(() => {
      result.current.advance(); 
    });
    expect(result.current.step).toBeNull();
    expect(ls.getItem(STORAGE_KEY)).toBeNull();
  });
});
