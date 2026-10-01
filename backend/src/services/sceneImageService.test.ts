import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getImageStorageProvider } from '../providers/storage/storageProviderFactory.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { turnHistoryRepository } from '../repositories/turnHistoryRepository.js';
import { ImageService } from './imageService.js';
import { readSceneImage, requestSceneImage } from './sceneImageService.js';
import { initializeDatabase } from '../persistence/database.js';

vi.mock('../providers/ai/images/imageBriefProvider.js', () => ({ generateImageBrief: vi.fn(async () => 'A troll on a bridge') }));

const DB_PATH = path.join(os.tmpdir(), `dnd-scene-image-test-${Date.now()}.sqlite`);
const IMAGE_DIR = path.join(os.tmpdir(), `dnd-scene-image-files-${Date.now()}`);

let seq = 0;
const newSession = async (imagePolicy: 'off' | 'on_demand' | 'automatic') => {
  const session = await sessionRepository.createSession('A troll bridge', 'normal', true, 'local', 'balanced', undefined, 'Troll Bridge', `scene-${++seq}`, 'one_evening', imagePolicy);
  const turnId = turnHistoryRepository.insertTurnResultSync(session.id, { narration: 'The troll grins.', choices: [], imagePrompt: null, imageSuggested: false }, null);
  return { session: (await sessionRepository.getSession(session.id))!, turnId };
};

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.IMAGE_STORAGE_PROVIDER = 'local';
  process.env.LOCAL_IMAGE_STORAGE_PATH = IMAGE_DIR;
  initializeDatabase();
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
  fs.rmSync(IMAGE_DIR, { recursive: true, force: true });
});

describe('image policy', () => {
  it('is the one setting, with savingsMode derived from it', async () => {
    const { session } = await newSession('on_demand');
    expect(session).toMatchObject({ imagePolicy: 'on_demand', savingsMode: true });
    await sessionRepository.setSavingsMode(session.id, false);
    expect(await sessionRepository.getSession(session.id)).toMatchObject({ imagePolicy: 'automatic', savingsMode: false });
    await sessionRepository.setSavingsMode(session.id, true);
    expect(await sessionRepository.getSession(session.id)).toMatchObject({ imagePolicy: 'off', savingsMode: true });
    sessionRepository.setImagePolicy(session.id, 'on_demand');
    expect(await sessionRepository.getSession(session.id)).toMatchObject({ imagePolicy: 'on_demand', savingsMode: true });
  });

  it('derives the policy for rows that only have savingsMode', async () => {
    const created = await sessionRepository.createSession('Old', 'normal', false, 'local', 'balanced', undefined, 'Old', `legacy-${++seq}`);
    const { getDb } = await import('../persistence/database.js');
    getDb().prepare('UPDATE sessions SET image_policy = NULL WHERE id = ?').run(created.id);
    expect(await sessionRepository.getSession(created.id)).toMatchObject({ imagePolicy: 'automatic', savingsMode: false });
  });
});

const admit = () => ({ ok: true as const });

describe('requestSceneImage', () => {
  it('refuses when pictures are off, without generating', async () => {
    const generate = vi.spyOn(ImageService, 'generateImage');
    const { session, turnId } = await newSession('off');
    expect(requestSceneImage({ session, turnId, admit, requestId: 'img-req-0001' })).toMatchObject({ status: 'error', code: 'images_off' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('paints one picture on request and attaches it to the turn', async () => {
    const stored = await getImageStorageProvider().putImage({ key: 'scene-test.png', contentType: 'image/png', body: Buffer.from('png-bytes') });
    const generate = vi.spyOn(ImageService, 'generateImage').mockResolvedValue({ url: stored.publicUrl, storageKey: stored.key, storageProvider: 'local' } as never);
    const { session, turnId } = await newSession('on_demand');
    const started = requestSceneImage({ session, turnId, admit, requestId: 'img-req-0002' });
    expect(started.status).toBe('pending');
    expect(started.status === 'pending' && await started.done).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);

    // Already painted: a new request returns it without painting again.
    expect(requestSceneImage({ session, turnId, admit, requestId: 'img-req-0003' })).toEqual({ status: 'ready' });
    expect(generate).toHaveBeenCalledTimes(1);

    expect(await readSceneImage(session.id, turnId, 1024)).toEqual({ status: 'image', data: Buffer.from('png-bytes').toString('base64'), mimeType: 'image/png' });
    expect(await readSceneImage(session.id, turnId, 4)).toEqual({ status: 'too_large' });
  });

  it('does not re-pay a failed request with the same id', async () => {
    const generate = vi.spyOn(ImageService, 'generateImage').mockResolvedValue(null);
    const { session, turnId } = await newSession('on_demand');
    const first = requestSceneImage({ session, turnId, admit, requestId: 'img-req-0004' });
    expect(first.status === 'pending' && await first.done).toBe(false);
    expect(requestSceneImage({ session, turnId, admit, requestId: 'img-req-0004' })).toMatchObject({ status: 'error', code: 'image_failed' });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('reports no picture for a scene without one', async () => {
    const { session, turnId } = await newSession('on_demand');
    expect(await readSceneImage(session.id, turnId, 1024)).toEqual({ status: 'none' });
  });

  // Behaviour change (plan 4 B5). Before: the assistant tool admitted (and charged a grant
  // attempt) before knowing whether painting was needed. After: free outcomes come first.
  it('settles free outcomes without admission', async () => {
    const refuse = vi.fn(() => ({ ok: false as const, code: 'limit_reached', message: 'spent' }));
    const { session, turnId } = await newSession('off');
    expect(requestSceneImage({ session, turnId, requestId: 'img-req-0005', admit: refuse })).toMatchObject({ code: 'images_off' });
    expect(requestSceneImage({ session, turnId: 9999, requestId: 'img-req-0006', admit: refuse })).toMatchObject({ code: 'turn_not_found' });
    expect(refuse).not.toHaveBeenCalled();
  });

  it('refuses through admission before painting', async () => {
    const generate = vi.spyOn(ImageService, 'generateImage');
    const { session, turnId } = await newSession('on_demand');
    const refused = requestSceneImage({ session, turnId, requestId: 'img-req-0007', admit: () => ({ ok: false, code: 'picture_limit', message: "The realm's painters are resting until tomorrow." }) });
    expect(refused).toMatchObject({ status: 'error', code: 'picture_limit' });
    expect(generate).not.toHaveBeenCalled();
  });
});
