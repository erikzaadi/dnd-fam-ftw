import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useKonamiCode } from './useKonamiCode';

const KONAMI_KEYS = [
  'ArrowUp', 'ArrowUp',
  'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight',
  'ArrowLeft', 'ArrowRight',
  'b', 'a',
];

const press = (key: string, target?: EventTarget) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true });
  (target ?? window).dispatchEvent(event);
};

describe('useKonamiCode', () => {
  it('fires onUnlock after the full sequence', () => {
    const onUnlock = vi.fn();
    renderHook(() => useKonamiCode(onUnlock));

    KONAMI_KEYS.forEach(key => press(key));

    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it('does not fire when a wrong key interrupts the sequence', () => {
    const onUnlock = vi.fn();
    renderHook(() => useKonamiCode(onUnlock));

    KONAMI_KEYS.slice(0, 8).forEach(key => press(key));
    press('x');
    press('b');
    press('a');

    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('recovers when the wrong key starts a fresh attempt', () => {
    const onUnlock = vi.fn();
    renderHook(() => useKonamiCode(onUnlock));

    press('ArrowUp');
    press('ArrowUp');
    press('ArrowUp');
    KONAMI_KEYS.slice(1).forEach(key => press(key));

    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it('ignores keys typed in text fields', () => {
    const onUnlock = vi.fn();
    renderHook(() => useKonamiCode(onUnlock));

    const input = document.createElement('input');
    document.body.appendChild(input);
    KONAMI_KEYS.forEach(key => press(key, input));
    input.remove();

    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('stops listening after unmount', () => {
    const onUnlock = vi.fn();
    const { unmount } = renderHook(() => useKonamiCode(onUnlock));
    unmount();

    KONAMI_KEYS.forEach(key => press(key));

    expect(onUnlock).not.toHaveBeenCalled();
  });
});
