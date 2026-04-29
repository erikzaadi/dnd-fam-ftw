import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/env.js';
import { getDb } from '../persistence/database.js';
import { getImageStorageProvider } from '../providers/storage/storageProviderFactory.js';

export const deleteSessionWithAssets = async (id: string): Promise<void> => {
  const db = getDb();
  const config = getConfig();
  const storage = getImageStorageProvider();

  const deleteImage = async (imageUrl: string | null, storageKey: string | null, storageProvider: string | null) => {
    if (!imageUrl) {
      return;
    }
    if (storageKey && storageProvider) {
      try {
        await storage.deleteImage(storageKey);
      } catch (err) {
        console.warn(`[StateService] Failed to delete image key "${storageKey}" from ${storageProvider}:`, err);
      }
    } else {
      // Fallback for records created before storage key tracking: delete from local path.
      const fileName = path.basename(imageUrl);
      const localPath = path.join(path.resolve(config.LOCAL_IMAGE_STORAGE_PATH), fileName);
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
      }
    }
  };

  const history = db.prepare('SELECT imageUrl, image_storage_key, image_storage_provider FROM turn_history WHERE sessionId = ?').all(id) as {
    imageUrl: string | null;
    image_storage_key: string | null;
    image_storage_provider: string | null;
  }[];
  for (const row of history) {
    await deleteImage(row.imageUrl, row.image_storage_key, row.image_storage_provider);
  }

  const characters = db.prepare('SELECT avatarUrl, avatar_storage_key, avatar_storage_provider FROM characters WHERE sessionId = ?').all(id) as {
    avatarUrl: string | null;
    avatar_storage_key: string | null;
    avatar_storage_provider: string | null;
  }[];
  for (const character of characters) {
    await deleteImage(character.avatarUrl, character.avatar_storage_key, character.avatar_storage_provider);
  }

  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  db.prepare('DELETE FROM turn_history WHERE sessionId = ?').run(id);
};
