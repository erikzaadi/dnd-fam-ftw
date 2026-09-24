import { createId } from '../lib/ids.js';
import type { Difficulty, Stat } from '../types.js';

// Server-side record of a free-action preview, so a confirmation carries server-verified
// mechanics instead of trusting the difficulty/stat values the client echoes back.
// In-memory is deliberate: a restart fails pending operations anyway, and an unknown
// preview simply asks the player to review the action again.
export type StoredActionPreview = {
  id: string;
  sessionId: string;
  revision: number;
  actingCharacterId: string;
  interpretedAction: string;
  stat: Stat;
  difficulty: Difficulty;
  difficultyValue?: number;
  createdAt: number;
};

const PREVIEW_TTL_MS = 60 * 60 * 1000;
const MAX_PREVIEWS = 2000;
const previews = new Map<string, StoredActionPreview>();

const prune = (now: number): void => {
  for (const [id, preview] of previews) {
    if (now - preview.createdAt > PREVIEW_TTL_MS || previews.size > MAX_PREVIEWS) {
      previews.delete(id);
    } else {
      break;
    }
  }
};

export const storeActionPreview = (preview: Omit<StoredActionPreview, 'id' | 'createdAt'>): string => {
  const now = Date.now();
  prune(now);
  const id = createId();
  previews.set(id, { ...preview, id, createdAt: now });
  return id;
};

export type PreviewLookup =
  | { status: 'valid'; preview: StoredActionPreview }
  | { status: 'stale' | 'unknown' };

export const lookupActionPreview = (previewId: string, sessionId: string, revision: number, actingCharacterId: string): PreviewLookup => {
  const preview = previews.get(previewId);
  if (!preview || preview.sessionId !== sessionId || Date.now() - preview.createdAt > PREVIEW_TTL_MS) {
    return { status: 'unknown' };
  }
  if (preview.revision !== revision || preview.actingCharacterId !== actingCharacterId) {
    return { status: 'stale' };
  }
  return { status: 'valid', preview };
};

export const clearActionPreviewsForTests = (): void => {
  previews.clear();
};
