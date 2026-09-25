import { createId } from '../lib/ids.js';
import type { ActionClarification, Difficulty, Stat } from '../types.js';

// Server-side record of an action preview. A confirmation that carries its id is exactly
// this action: kind, identity and mechanics come from here, never from client echoes.
// In-memory is deliberate: a restart fails pending operations anyway, and an unknown
// preview simply asks the player to review the action again.
export type PreviewActionKind = 'free_text' | 'item_use' | 'item_give';

export type StoredActionPreview = {
  id: string;
  sessionId: string;
  revision: number;
  actingCharacterId: string;
  kind: PreviewActionKind;
  originalAction: string;
  interpretedAction: string;
  actionIntent?: string;
  itemId?: string;
  itemOwnerCharacterId?: string;
  targetCharacterId?: string;
  // Replies that settled this draft (e.g. "yes" to a riddle question). Confirmation
  // re-judges the draft with them, so preview and commit agree.
  clarifications?: ActionClarification[];
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

// actingCharacterId is optional: a confirmation resolves the actor from the preview
// itself, while callers that already know the actor also check it matches.
export const lookupActionPreview = (previewId: string, sessionId: string, revision: number, actingCharacterId?: string): PreviewLookup => {
  const preview = previews.get(previewId);
  if (!preview || preview.sessionId !== sessionId || Date.now() - preview.createdAt > PREVIEW_TTL_MS) {
    return { status: 'unknown' };
  }
  if (preview.revision !== revision || (actingCharacterId !== undefined && preview.actingCharacterId !== actingCharacterId)) {
    return { status: 'stale' };
  }
  return { status: 'valid', preview };
};

export const clearActionPreviewsForTests = (): void => {
  previews.clear();
};
