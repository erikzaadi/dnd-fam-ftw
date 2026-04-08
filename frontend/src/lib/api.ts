const BASE = import.meta.env.BASE_URL; // '/dnd-fam-ftw/' in prod/dev, configurable

/** Build an API URL: api('/session/123') → '/dnd-fam-ftw/api/session/123' */
export const api = (path: string) => `${BASE}api${path}`;

/** Resolve a backend image URL against the base path.
 *  imgSrc('/api/images/foo.png') → '/dnd-fam-ftw/api/images/foo.png'
 *  imgSrc(null) → '/dnd-fam-ftw/api/images/default_scene.png'
 */
export const imgSrc = (url: string | null | undefined) => {
  const src = url || '/api/images/default_scene.png';
  return `${BASE}${src.replace(/^\//, '')}`;
};
