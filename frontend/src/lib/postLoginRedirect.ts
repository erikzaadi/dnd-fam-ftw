// Remembers where to return after sign-in, for pages an outside app sends the player
// to (the MCP OAuth consent page). Only allowlisted in-app paths are stored, and the
// entry expires, so it can never become an open redirect or a stale detour.

const KEY = 'dnd-post-login-redirect';
const LIFETIME_MS = 15 * 60 * 1000;
const ALLOWED_PREFIXES = ['/oauth/consent'];

const isAllowed = (path: string): boolean =>
  path.startsWith('/') && !path.startsWith('//') && ALLOWED_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}?`));

export const rememberPostLoginPath = (path: string): void => {
  if (!isAllowed(path)) {
    return;
  }
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // Storage unavailable: the player simply lands on the home page after sign-in.
  }
};

export const peekPostLoginPath = (): string | null => {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) {
      return null;
    }
    const entry = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof entry.path !== 'string' || typeof entry.at !== 'number' || Date.now() - entry.at > LIFETIME_MS || !isAllowed(entry.path)) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return entry.path;
  } catch {
    return null;
  }
};

export const clearPostLoginPath = (): void => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
};
