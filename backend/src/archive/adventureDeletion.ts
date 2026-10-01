import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/env.js';
import { getDb } from '../persistence/database.js';
import { withTransaction } from '../persistence/transaction.js';
import { getImageStorageProvider } from '../providers/storage/storageProviderFactory.js';
import type { ImageStorageProvider } from '../providers/storage/ImageStorageProvider.js';
import { operationRepository } from '../repositories/operationRepository.js';

// Deleting an adventure: its images, then its rows.
//
// Images (media inventory). An adventure's pictures live in:
//   - turn_history: imageUrl + image_storage_key (scene pictures)
//   - characters: avatarUrl + avatar_storage_key (hero portraits)
//   - sessions: origin_story_image_url + origin_story_image_storage_key
//   - sessions.encounter_state and past_encounters (JSON): enemy avatarUrl and area
//     imageUrl, stored as URLs only (the key is the URL past the storage's public base)
// The list preview (sessions.preview_image_url) is not deleted here, as before.
// An imported copy shares these references with its original (the archive copies
// references, never files), so an image is deleted only when no other adventure still
// references it, by storage key or by URL.
//
// Rows, per table (deleted in one transaction, after the images):
//   sessions                  deleted; characters, inventory, turn_history, turn_choices
//                             and session_riddles go with it (explicit or cascade)
//   scene_image_requests      deleted (no cascade)
//   mcp_auto_confirm          deleted (no cascade)
//   session_operations        deleted (no cascade)
//   adventure_create_commands kept: a replayed assistant create then gets 410
//                             adventure_deleted instead of silently creating a new one
//   provider_usage            kept: billing history
// No transaction covers storage and the database together.

// byUrl: stored as a URL only (encounter pictures).
type ImageRef = { url: string | null; key: string | null; provider: string | null; byUrl?: boolean };

export type DeleteAdventureDeps = {
  storage?: ImageStorageProvider;
  // Folder of images stored before storage keys were tracked.
  legacyImageDir?: string;
};

export type DeleteReport = { imagesDeleted: number; imagesShared: number };

const urlsInJson = (value: string | null): string[] => {
  if (!value) {
    return [];
  }
  try {
    const found: string[] = [];
    const walk = (node: unknown, key?: string) => {
      if (typeof node === 'string' && (key === 'avatarUrl' || key === 'imageUrl')) {
        found.push(node);
      } else if (Array.isArray(node)) {
        node.forEach(child => walk(child));
      } else if (typeof node === 'object' && node !== null) {
        Object.entries(node).forEach(([childKey, child]) => walk(child, childKey));
      }
    };
    walk(JSON.parse(value));
    return found;
  } catch {
    return [];
  }
};

// Every image the adventure references.
export const adventureImages = (adventureId: string): ImageRef[] => {
  const db = getDb();
  const refs: ImageRef[] = [];
  for (const row of db.prepare('SELECT imageUrl, image_storage_key, image_storage_provider FROM turn_history WHERE sessionId = ?').all(adventureId) as { imageUrl: string | null; image_storage_key: string | null; image_storage_provider: string | null }[]) {
    refs.push({ url: row.imageUrl, key: row.image_storage_key, provider: row.image_storage_provider });
  }
  for (const row of db.prepare('SELECT avatarUrl, avatar_storage_key, avatar_storage_provider FROM characters WHERE sessionId = ?').all(adventureId) as { avatarUrl: string | null; avatar_storage_key: string | null; avatar_storage_provider: string | null }[]) {
    refs.push({ url: row.avatarUrl, key: row.avatar_storage_key, provider: row.avatar_storage_provider });
  }
  const session = db.prepare('SELECT origin_story_image_url, origin_story_image_storage_key, origin_story_image_storage_provider, encounter_state, past_encounters FROM sessions WHERE id = ?').get(adventureId) as {
    origin_story_image_url: string | null;
    origin_story_image_storage_key: string | null;
    origin_story_image_storage_provider: string | null;
    encounter_state: string | null;
    past_encounters: string | null;
  } | undefined;
  if (session) {
    refs.push({ url: session.origin_story_image_url, key: session.origin_story_image_storage_key, provider: session.origin_story_image_storage_provider });
    for (const url of [...urlsInJson(session.encounter_state), ...urlsInJson(session.past_encounters)]) {
      refs.push({ url, key: null, provider: null, byUrl: true });
    }
  }
  return refs.filter(ref => ref.url);
};

// Whether another adventure still references the image.
const referencedElsewhere = (adventureId: string, ref: ImageRef): boolean => {
  const db = getDb();
  const url = ref.url ?? '';
  const key = ref.key ?? '';
  const hit = (sql: string, ...params: unknown[]) => !!db.prepare(sql).get(...params as never[]);
  return hit('SELECT 1 FROM turn_history WHERE sessionId != ? AND ((? != \'\' AND image_storage_key = ?) OR imageUrl = ?) LIMIT 1', adventureId, key, key, url)
    || hit('SELECT 1 FROM characters WHERE sessionId != ? AND ((? != \'\' AND avatar_storage_key = ?) OR avatarUrl = ?) LIMIT 1', adventureId, key, key, url)
    || hit('SELECT 1 FROM sessions WHERE id != ? AND ((? != \'\' AND origin_story_image_storage_key = ?) OR origin_story_image_url = ? OR instr(COALESCE(encounter_state, \'\'), ?) > 0 OR instr(COALESCE(past_encounters, \'\'), ?) > 0) LIMIT 1', adventureId, key, key, url, url, url);
};

// The storage key of an image stored by URL only (encounter pictures).
const keyFromUrl = (storage: ImageStorageProvider, url: string): string | null => {
  const base = storage.getPublicUrl('');
  return url.startsWith(base) && url.length > base.length ? url.slice(base.length) : null;
};

export const deleteAdventure = async (adventureId: string, deps: DeleteAdventureDeps = {}): Promise<DeleteReport> => {
  const storage = deps.storage ?? getImageStorageProvider();
  const legacyImageDir = deps.legacyImageDir ?? path.resolve(getConfig().LOCAL_IMAGE_STORAGE_PATH);
  const report: DeleteReport = { imagesDeleted: 0, imagesShared: 0 };

  const seen = new Set<string>();
  for (const ref of adventureImages(adventureId)) {
    const identity = ref.key ?? ref.url!;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    if (referencedElsewhere(adventureId, ref)) {
      report.imagesShared++;
      continue;
    }
    const key = ref.key && ref.provider ? ref.key : ref.byUrl ? keyFromUrl(storage, ref.url!) : null;
    if (key) {
      try {
        await storage.deleteImage(key);
        report.imagesDeleted++;
      } catch (err) {
        console.warn(`[AdventureDeletion] Failed to delete image key "${key}":`, err);
      }
    } else if (!ref.byUrl) {
      // Images stored before storage keys were tracked: delete from the local folder.
      const localPath = path.join(legacyImageDir, path.basename(ref.url!));
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
        report.imagesDeleted++;
      }
    }
  }

  withTransaction(() => {
    const db = getDb();
    db.prepare('DELETE FROM sessions WHERE id = ?').run(adventureId);
    db.prepare('DELETE FROM turn_history WHERE sessionId = ?').run(adventureId);
    db.prepare('DELETE FROM session_riddles WHERE session_id = ?').run(adventureId);
    db.prepare('DELETE FROM scene_image_requests WHERE session_id = ?').run(adventureId);
    db.prepare('DELETE FROM mcp_auto_confirm WHERE session_id = ?').run(adventureId);
    operationRepository.deleteForSession(adventureId);
  });
  return report;
};
