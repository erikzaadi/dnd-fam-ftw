// BASE: Vite base path ('/dnd-fam-ftw/' local, '/' for AWS build)
const BASE = import.meta.env.BASE_URL;

// VITE_API_BASE_URL: full backend origin for cross-domain deployments.
// Leave unset (or empty) for local dev - the Vite proxy handles routing.
// Set to 'https://api.fam-dnd-ftw.erikzaadi.com' for AWS production builds.
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

/** Build an API URL: api('/session/123') → '/dnd-fam-ftw/api/session/123' (local)
 *  or 'https://api.fam-dnd-ftw.erikzaadi.com/api/session/123' (AWS) */
export const api = (path: string) => `${API_BASE}${BASE}api${path}`;

/** Resolve a backend image URL.
 *  - Absolute URLs (S3, CDN): returned as-is.
 *  - Relative backend paths: prefixed with API_BASE + BASE.
 *  - null/undefined: falls back to default scene image. */
export const imgSrc = (url: string | null | undefined) => {
  const src = url || '/api/images/default_scene.png';
  if (/^https?:\/\//.test(src)) return src;
  return `${API_BASE}${BASE}${src.replace(/^\//, '')}`;
};

/** Returns an animationDelay that phases an element into the global pulse cycle,
 *  so elements rendered at different times stay visually in sync. */
export const pulseSyncDelay = (durationMs = 2500) =>
  `-${(performance.now() % durationMs) / 1000}s`;
