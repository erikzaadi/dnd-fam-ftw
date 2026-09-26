// Redirect URI rules for MCP OAuth clients (native apps, RFC 8252):
// - http only on loopback (127.0.0.1, [::1], localhost), where the port may differ
//   between registration and use because clients pick a free port per sign-in;
// - https anywhere;
// - no fragments, no credentials, nothing else (no custom schemes).
// Everything else must match the registered URI exactly.

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);
export const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LENGTH = 2000;

const parse = (raw: string): URL | null => {
  if (typeof raw !== 'string' || raw.length > MAX_REDIRECT_URI_LENGTH) {
    return null;
  }
  try {
    return new URL(raw);
  } catch {
    return null;
  }
};

const isLoopback = (url: URL): boolean => url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);

export const isAllowedRedirectUri = (raw: string): boolean => {
  const url = parse(raw);
  if (!url || url.hash || url.username || url.password) {
    return false;
  }
  return url.protocol === 'https:' || isLoopback(url);
};

// requested matches registered exactly, or both are the same loopback URI apart from
// the port.
export const redirectUriMatches = (requested: string, registered: string): boolean => {
  if (requested === registered) {
    return true;
  }
  const a = parse(requested);
  const b = parse(registered);
  if (!a || !b || !isLoopback(a) || !isLoopback(b) || a.hash) {
    return false;
  }
  return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
};

export const findRegisteredRedirectUri = (requested: string | undefined, registered: string[]): string | null => {
  if (requested === undefined || requested === '') {
    return registered.length === 1 ? registered[0] : null;
  }
  return registered.some(uri => redirectUriMatches(requested, uri)) && isAllowedRedirectUri(requested) ? requested : null;
};
