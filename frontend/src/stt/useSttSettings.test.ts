import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSttSettings } from './useSttSettings';

describe('useSttSettings', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          for (const key of Object.keys(store)) {
            delete store[key];
          }
        },
      },
    });
  });

  it('defaults speech input to disabled', () => {
    const { result } = renderHook(() => useSttSettings());
    expect(result.current.settings.enabled).toBe(false);
  });

  it('persists the enabled setting', () => {
    const { result, rerender } = renderHook(() => useSttSettings());

    act(() => {
      result.current.setEnabled(true);
    });
    rerender();

    expect(JSON.parse(localStorage.getItem('dnd-stt-settings') ?? '{}')).toEqual({ enabled: true });
  });
});
