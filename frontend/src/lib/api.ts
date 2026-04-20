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

/** Fetch an API endpoint with credentials. Builds the correct URL for dev and prod.
 *  apiFetch('/sessions') or apiFetch('/session/123', { method: 'DELETE' })
 */
export const apiFetch = (path: string, init?: RequestInit) =>
  fetch(apiUrl(path), { credentials: 'include', ...init });

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

/** Returns an animationDelay that phases an element into the global pulse cycle,
 *  so elements rendered at different times stay visually in sync. */
export const pulseSyncDelay = (durationMs = 2500) =>
  `-${(performance.now() % durationMs) / 1000}s`;
