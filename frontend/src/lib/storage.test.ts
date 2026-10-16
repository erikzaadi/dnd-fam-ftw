import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStorage, writeStorage } from './storage';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('storage', () => {
  it('reads, writes and removes', () => {
    writeStorage('k', 'v');
    expect(readStorage('k')).toBe('v');
    writeStorage('k', null);
    expect(readStorage('k')).toBeNull();
  });

  it('survives a localStorage getter that throws (site data blocked)', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(readStorage('k')).toBeNull();
    expect(() => writeStorage('k', 'v')).not.toThrow();
  });

  it('survives storage methods that throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(readStorage('k')).toBeNull();
    expect(() => writeStorage('k', 'v')).not.toThrow();
  });
});
