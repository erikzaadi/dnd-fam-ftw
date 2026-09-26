import { createId } from '../lib/ids.js';
import type { ActionClarification, Difficulty, FreeActionPreview, Stat } from '../types.js';

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
  // Set for MCP previews: only the same token may confirm, and a replayed preview
  // request returns this exact public preview.
  principal?: string;
  publicPreview?: FreeActionPreview;
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

export const storeActionPreviewRecord = (preview: Omit<StoredActionPreview, 'id' | 'createdAt'>): StoredActionPreview => {
  const now = Date.now();
  prune(now);
  const record: StoredActionPreview = { ...preview, id: createId(), createdAt: now };
  previews.set(record.id, record);
  return record;
};

export const storeActionPreview = (preview: Omit<StoredActionPreview, 'id' | 'createdAt'>): string =>
  storeActionPreviewRecord(preview).id;

// Raw lookup for callers that check binding themselves (MCP confirm_action).
export const getActionPreview = (previewId: string): StoredActionPreview | null => {
  const preview = previews.get(previewId);
  return preview && Date.now() - preview.createdAt <= PREVIEW_TTL_MS ? preview : null;
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
