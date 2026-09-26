import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPostLoginPath, peekPostLoginPath, rememberPostLoginPath } from './postLoginRedirect';

beforeEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
});

describe('postLoginRedirect', () => {
  it('remembers the consent page until cleared', () => {
    rememberPostLoginPath('/oauth/consent?request=abc');
    expect(peekPostLoginPath()).toBe('/oauth/consent?request=abc');
    expect(peekPostLoginPath()).toBe('/oauth/consent?request=abc');
    clearPostLoginPath();
    expect(peekPostLoginPath()).toBeNull();
  });

  it('ignores paths outside the allowlist', () => {
    for (const path of ['/', '/settings', '//evil.example.com/oauth/consent', 'https://evil.example.com/oauth/consent', '/oauth/consentx']) {
      rememberPostLoginPath(path);
      expect(peekPostLoginPath()).toBeNull();
    }
  });

  it('forgets old entries', () => {
    vi.useFakeTimers();
    rememberPostLoginPath('/oauth/consent?request=abc');
    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(peekPostLoginPath()).toBeNull();
  });
});
