import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, initializeDatabase } from '../persistence/database.js';
import type { ImageStorageProvider } from '../providers/storage/ImageStorageProvider.js';
import { operationRepository } from '../repositories/operationRepository.js';
import { adventureArchive } from './adventureArchive.js';
import { AdventureBusyError, deleteAdventure } from './adventureDeletion.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-deletion-test-${Date.now()}.sqlite`);
let seq = 0;

const fakeStorage = (deleteImage: (key: string) => Promise<void> = async () => undefined) => {
  const storage = {
    putImage: vi.fn(),
    getPublicUrl: (key: string) => `/img/${key}`,
    exists: vi.fn(),
    getImage: vi.fn(),
    deleteImage: vi.fn(deleteImage),
  };
  return storage as typeof storage & ImageStorageProvider;
};

// An adventure with a scene picture, a hero portrait, an origin-story picture and
// encounter enemy and area pictures (URL only), plus runtime rows.
const seed = () => {
  const id = `del-${++seq}`;
  const db = getDb();
  db.prepare(`INSERT INTO sessions (id, scene, sceneId, displayName, namespace_id, origin_story_image_url, origin_story_image_storage_key, origin_story_image_storage_provider, encounter_state)
    VALUES (?, 'A cave', 'cave-1', 'Deletion Realm', 'local', ?, ?, 'local', ?)`)
    .run(id, `/img/origin-${id}.png`, `origin-${id}.png`, JSON.stringify({ enemies: [{ id: 'goblin', avatarUrl: `/img/enemy-${id}.png` }], areas: [{ id: 'gate', imageUrl: `/img/area-${id}.png` }] }));
  db.prepare("INSERT INTO characters (id, sessionId, name, class, species, quirk, avatarUrl, avatar_storage_key, avatar_storage_provider) VALUES (?, ?, 'Pip', 'Rogue', 'Halfling', 'Hums', ?, ?, 'local')")
    .run(`${id}-pip`, id, `/img/pip-${id}.png`, `pip-${id}.png`);
  db.prepare("INSERT INTO turn_history (sessionId, narration, imageUrl, image_storage_key, image_storage_provider) VALUES (?, 'A turn', ?, ?, 'local')")
    .run(id, `/img/turn-${id}.png`, `turn-${id}.png`);
  db.prepare("INSERT INTO mcp_auto_confirm (user_id, session_id, enabled, updated_at) VALUES ('u', ?, 1, 0)").run(id);
  return id;
};

const imageKeys = (id: string) => [`turn-${id}.png`, `pip-${id}.png`, `origin-${id}.png`, `enemy-${id}.png`, `area-${id}.png`];
const count = (sql: string, id: string) => (getDb().prepare(sql).get(id) as { n: number }).n;

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  initializeDatabase();
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

describe('deleteAdventure', () => {
  it('deletes the rows and every image, including encounter pictures', async () => {
    const id = seed();
    const storage = fakeStorage();

    const report = await deleteAdventure(id, { storage });

    expect(storage.deleteImage.mock.calls.map(call => call[0]).sort()).toEqual(imageKeys(id).sort());
    expect(report).toEqual({ imagesDeleted: 5, imagesShared: 0 });
    expect(count('SELECT COUNT(*) AS n FROM sessions WHERE id = ?', id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM turn_history WHERE sessionId = ?', id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM characters WHERE sessionId = ?', id)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM mcp_auto_confirm WHERE session_id = ?', id)).toBe(0);
  });

  it('still deletes the rows when storage fails', async () => {
    const id = seed();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await deleteAdventure(id, { storage: fakeStorage(async () => {
      throw new Error('bucket unavailable');
    }) });
    expect(count('SELECT COUNT(*) AS n FROM sessions WHERE id = ?', id)).toBe(0);
  });

  it('rolls back every row when one delete fails', async () => {
    const id = seed();
    const spy = vi.spyOn(operationRepository, 'deleteForSession').mockImplementation(() => {
      throw new Error('disk I/O error');
    });
    try {
      await expect(deleteAdventure(id, { storage: fakeStorage() })).rejects.toThrow('disk I/O error');
    } finally {
      spy.mockRestore();
    }
    expect(count('SELECT COUNT(*) AS n FROM sessions WHERE id = ?', id)).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM turn_history WHERE sessionId = ?', id)).toBe(1);
  });

  it('keeps the images an imported copy still uses, whichever is deleted first', async () => {
    const original = seed();
    const copyOf = (id: string) => adventureArchive.import(adventureArchive.export({ adventureId: id })).adventures[0].newId;

    const copy = copyOf(original);
    const deletingCopy = fakeStorage();
    expect(await deleteAdventure(copy, { storage: deletingCopy })).toEqual({ imagesDeleted: 0, imagesShared: 5 });
    expect(deletingCopy.deleteImage).not.toHaveBeenCalled();

    const secondCopy = copyOf(original);
    const deletingOriginal = fakeStorage();
    expect(await deleteAdventure(original, { storage: deletingOriginal })).toEqual({ imagesDeleted: 0, imagesShared: 5 });
    expect(deletingOriginal.deleteImage).not.toHaveBeenCalled();

    // The last holder takes the images with it.
    const deletingLast = fakeStorage();
    expect(await deleteAdventure(secondCopy, { storage: deletingLast })).toEqual({ imagesDeleted: 5, imagesShared: 0 });
  });

  // Behaviour change (plan 3 decision 7). Before: deletion had no guard. After: refused
  // while an operation runs, deleting nothing.
  it('refuses while an operation is running, deleting nothing', async () => {
    const id = seed();
    operationRepository.accept({ sessionId: id, namespaceId: 'local', kind: 'action', requestId: `busy-${id}`, payloadHash: 'h' });
    const storage = fakeStorage();

    await expect(deleteAdventure(id, { storage })).rejects.toBeInstanceOf(AdventureBusyError);
    expect(storage.deleteImage).not.toHaveBeenCalled();
    expect(count('SELECT COUNT(*) AS n FROM sessions WHERE id = ?', id)).toBe(1);
  });
});
