// BASE: Vite base path ('/dnd-fam-ftw/' local, '/' for AWS build)
const BASE = import.meta.env.BASE_URL;

// VITE_API_BASE_URL: full backend origin for cross-domain deployments.
// Leave unset (or empty) for local dev - the Vite proxy handles routing.
// Set to 'https://api.dnd-fam-ftw.erikzaadi.com' for AWS production builds.
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

/** Build an API URL without fetching - for EventSource and other non-fetch APIs. */
export const apiUrl = (path: string) => API_BASE
  ? `${API_BASE}${path}`
  : `${BASE}api${path}`;

// The realm this page was loaded for. Sent with every namespace-scoped call so the
// backend can refuse a stale tab after another tab switched realms (the cookie is
// shared). A consistency check only; the cookie decides access.
let expectedNamespaceId: string | null = null;

export const setExpectedNamespace = (namespaceId: string | null) => {
  expectedNamespaceId = namespaceId;
};

const withNamespaceHeader = (path: string, init?: RequestInit): RequestInit | undefined => {
  if (!expectedNamespaceId || path.startsWith('/auth/')) {
    return init;
  }
  const headers = new Headers(init?.headers);
  headers.set('X-Namespace-Id', expectedNamespaceId);
  return { ...init, headers };
};

let reloadingForNamespaceChange = false;

// Another tab switched realms: this page holds the old realm's state, so start over
// from Home with a full load instead of acting in the wrong realm.
const reloadIfNamespaceChanged = async (res: Response): Promise<void> => {
  if (res.status !== 409 || reloadingForNamespaceChange) {
    return;
  }
  const body = await res.clone().json().catch(() => null) as { error?: string } | null;
  if (body?.error === 'namespace_changed') {
    reloadingForNamespaceChange = true;
    window.location.assign(BASE);
  }
};

/** Fetch an API endpoint with credentials. Builds the correct URL for dev and prod.
 *  apiFetch('/sessions') or apiFetch('/session/123', { method: 'DELETE' })
 */
export const apiFetch = async (path: string, init?: RequestInit) => {
  const res = await fetch(apiUrl(path), { credentials: 'include', ...withNamespaceHeader(path, init) });
  await reloadIfNamespaceChanged(res);
  return res;
};

/** Switch the signed-in user's active realm, then reload the app at Home so no
 *  state from the previous realm survives. Resolves false if the switch failed. */
export const switchNamespace = async (namespaceId: string): Promise<boolean> => {
  try {
    const res = await apiFetch('/auth/session/namespace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespaceId }),
    });
    if (!res.ok) {
      return false;
    }
  } catch {
    return false;
  }
  window.location.assign(BASE);
  return true;
};

/** Resolve an image URL.
 *  - Absolute URLs (S3, CDN): returned as-is.
 *  - /images/* paths: served from the frontend CDN (frontend/public/images/).
 *  - Other relative paths: resolved via apiUrl (backend API).
 *  - null/undefined: falls back to default scene image. */
export const imgSrc = (url: string | null | undefined) => {
  const src = url || '/images/default_scene.png';
  if (/^https?:\/\//.test(src)) {
    return src;
  }
  if (src.startsWith('/images/')) {
    return `${BASE}${src.slice(1)}`;
  }
  return apiUrl(src);
};

/** Resolve a static asset from frontend/public using Vite's base path. */
export const publicAssetUrl = (path: string) =>
  `${BASE}${path.replace(/^\//, '')}`;

/** Returns an animationDelay that phases an element into the global pulse cycle,
 *  so elements rendered at different times stay visually in sync. */
export const pulseSyncDelay = (durationMs = 2500) =>
  `-${(performance.now() % durationMs) / 1000}s`;
