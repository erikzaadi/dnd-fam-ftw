import { describe, expect, it } from 'vitest';
import { findRegisteredRedirectUri, isAllowedRedirectUri, redirectUriMatches } from './redirectUris.js';

describe('redirect URI rules', () => {
  it.each([
    'http://127.0.0.1:33418/callback', 'http://localhost:8080/cb', 'http://[::1]:9000/cb', 'https://claude.ai/api/mcp/auth_callback',
  ])('allows %s', uri => {
    expect(isAllowedRedirectUri(uri)).toBe(true);
  });

  it.each([
    'http://example.com/cb', 'http://192.168.1.2:80/cb', 'cursor://anysphere/cb', 'https://example.com/cb#frag',
    'https://user:pw@example.com/cb', 'javascript:alert(1)', 'not a url',
  ])('refuses %s', uri => {
    expect(isAllowedRedirectUri(uri)).toBe(false);
  });

  it('lets loopback ports differ but nothing else', () => {
    expect(redirectUriMatches('http://127.0.0.1:5555/callback', 'http://127.0.0.1/callback')).toBe(true);
    expect(redirectUriMatches('http://127.0.0.1:5555/callback', 'http://127.0.0.1:1234/callback')).toBe(true);
    expect(redirectUriMatches('http://127.0.0.1:5555/other', 'http://127.0.0.1/callback')).toBe(false);
    expect(redirectUriMatches('http://localhost:5555/callback', 'http://127.0.0.1/callback')).toBe(false);
    expect(redirectUriMatches('https://app.example.com:444/cb', 'https://app.example.com/cb')).toBe(false);
    expect(redirectUriMatches('https://app.example.com/cb?x=1', 'https://app.example.com/cb')).toBe(false);
  });

  it('uses the only registered URI when none is requested', () => {
    expect(findRegisteredRedirectUri(undefined, ['https://a.example.com/cb'])).toBe('https://a.example.com/cb');
    expect(findRegisteredRedirectUri(undefined, ['https://a.example.com/cb', 'https://b.example.com/cb'])).toBeNull();
    expect(findRegisteredRedirectUri('https://evil.example.com/cb', ['https://a.example.com/cb'])).toBeNull();
  });
});
