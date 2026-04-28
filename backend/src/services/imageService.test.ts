import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ImageService } from './imageService.js';
import type { ImageProvider } from '../providers/ai/images/ImageProvider.js';
import type { ImageStorageProvider, StoredImage } from '../providers/storage/ImageStorageProvider.js';

const TEST_IMG_DIR = path.join(os.tmpdir(), `dnd-test-imgs-${Date.now()}`);

beforeAll(() => {
  process.env.LOCAL_IMAGE_STORAGE_PATH = TEST_IMG_DIR;
  process.env.LOCAL_IMAGE_PUBLIC_BASE_URL = '/test-images';
  process.env.IMAGE_STORAGE_PROVIDER = 'local';
  process.env.SQLITE_DB_PATH = path.join(os.tmpdir(), `dnd-test-state-img-${Date.now()}.sqlite`);
});

afterAll(() => {
  try {
    fs.rmSync(TEST_IMG_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const FAKE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function makeMockStorage(existingKeys: Set<string> = new Set()): ImageStorageProvider & { stored: Map<string, Buffer> } {
  const stored = new Map<string, Buffer>();
  return {
    stored,
    putImage: async ({ key, body }: { key: string; contentType: string; body: Buffer; cacheControl?: string }): Promise<StoredImage> => {
      stored.set(key, body);
      return { key, publicUrl: `http://mock-storage/${key}` };
    },
    getPublicUrl: (key: string): string => `http://mock-storage/${key}`,
    exists: async (key: string): Promise<boolean> => existingKeys.has(key) || stored.has(key),
    deleteImage: async (): Promise<void> => { /* no-op */ },
  };
}

function makeMockImageProvider(returnUrl: string = FAKE_DATA_URL): ImageProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    generateImage: async ({ prompt }: { prompt: string }): Promise<{ url: string }> => {
      calls.push(prompt);
      return { url: returnUrl };
    },
  };
}

describe('ImageService.generateImage', () => {
  it('cache miss: calls provider and stores result', async () => {
    const storage = makeMockStorage();
    const provider = makeMockImageProvider();
    const result = await ImageService.generateImage('A dragon attacks', 'sess-1', 1, false, provider, storage);
    expect(result).not.toBeNull();
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toContain('A dragon attacks');
    expect(storage.stored.size).toBe(1);
    expect(result!.url).toMatch(/^http:\/\/mock-storage\//);
  });

  it('cache hit: skips provider and returns cached URL', async () => {
    const provider = makeMockImageProvider();
    const prompt = 'A dragon attacks';
    const hash = crypto.createHash('md5').update(prompt).digest('hex');
    const cachedKey = `sess-cached_turn1_${hash}.png`;
    const storage = makeMockStorage(new Set([cachedKey]));
    const result = await ImageService.generateImage(prompt, 'sess-cached', 1, false, provider, storage);
    expect(result).not.toBeNull();
    expect(provider.calls).toHaveLength(0);
    expect(result!.url).toContain(cachedKey);
  });

  it('returns null on provider failure', async () => {
    const storage = makeMockStorage();
    const failProvider: ImageProvider = {
      generateImage: async (): Promise<{ url: string }> => {
        throw new Error('Provider exploded');
      },
    };
    const result = await ImageService.generateImage('A goblin sneaks', 'sess-fail', 2, false, failProvider, storage);
    expect(result).toBeNull();
  });

  it('retries with sanitized prompt on content_policy_violation', async () => {
    const storage = makeMockStorage();
    let callCount = 0;
    const receivedPrompts: string[] = [];
    const policyProvider: ImageProvider = {
      generateImage: async ({ prompt }: { prompt: string }): Promise<{ url: string }> => {
        callCount++;
        receivedPrompts.push(prompt);
        if (callCount === 1) {
          const err = new Error('Content policy violation') as Error & { code: string };
          err.code = 'content_policy_violation';
          throw err;
        }
        return { url: FAKE_DATA_URL };
      },
    };
    const result = await ImageService.generateImage('kill the undead skeleton', 'sess-policy', 3, false, policyProvider, storage);
    expect(result).not.toBeNull();
    expect(callCount).toBe(2);
    expect(receivedPrompts[1]).not.toContain('undead');
    expect(receivedPrompts[1]).not.toContain('skeleton');
    expect(receivedPrompts[1]).not.toContain('kill');
  });

  it('returns null when sanitized retry also fails', async () => {
    const storage = makeMockStorage();
    const alwaysFailProvider: ImageProvider = {
      generateImage: async (): Promise<{ url: string }> => {
        const err = new Error('Content policy') as Error & { code: string };
        err.code = 'content_policy_violation';
        throw err;
      },
    };
    const result = await ImageService.generateImage('undead attack', 'sess-double-policy', 4, false, alwaysFailProvider, storage);
    expect(result).toBeNull();
  });
});

describe('ImageService.generateAvatar', () => {
  it('cache miss: calls provider and stores result', async () => {
    const storage = makeMockStorage();
    const provider = makeMockImageProvider();
    const char = { name: 'Pip', class: 'Rogue', species: 'Halfling', quirk: 'Talks to plants' };
    const result = await ImageService.generateAvatar(char, 'sess-avatar-1', false, provider, storage);
    expect(result.url).toBeTruthy();
    expect(result.prompt).toContain('Halfling Rogue');
    expect(result.prompt).toContain('Pip');
    expect(result.prompt).toContain('Talks to plants');
    expect(result.prompt).toContain('one subject only');
    expect(result.prompt).toContain('no split screen');
    expect(provider.calls).toHaveLength(1);
    expect(storage.stored.size).toBe(1);
  });

  it('cache hit: skips provider', async () => {
    const provider = makeMockImageProvider();
    const char = { name: 'Pip', class: 'Rogue', species: 'Halfling', quirk: 'Talks to plants' };
    const prompt = `single finished fantasy character portrait of one ${char.species} ${char.class}, visual personality inspired by the character name "${char.name}" but do not write the name, subtle visual personality cue: ${char.quirk}, one subject only, one face only, single uninterrupted image, no split screen, no side-by-side panels, no duplicate portrait, detailed face, centered head-and-shoulders composition, plain dark background, vibrant colors, cinematic lighting, painterly storybook art, no interface, no editor controls, no crop guides, no grid lines, no color palettes, no overlays, no text or writing`;
    const hash = crypto.createHash('md5').update(prompt).digest('hex');
    const cachedKey = `avatar_sess-avatar-cached_${char.name}_${hash}.png`;
    const storage = makeMockStorage(new Set([cachedKey]));
    const result = await ImageService.generateAvatar(char, 'sess-avatar-cached', false, provider, storage);
    expect(provider.calls).toHaveLength(0);
    expect(result.url).toContain(cachedKey);
  });

  it('falls back to initials SVG on provider failure', async () => {
    const storage = makeMockStorage();
    const failProvider: ImageProvider = {
      generateImage: async (): Promise<{ url: string }> => {
        throw new Error('Avatar provider exploded');
      },
    };
    const char = { name: 'Zomgush', class: 'Barbarian', species: 'Orc', quirk: 'Hates silence' };
    const result = await ImageService.generateAvatar(char, 'sess-avatar-fail', false, failProvider, storage);
    expect(result.url).toBeTruthy();
    expect(result.url).toContain('avatar_initials');
    expect(storage.stored.size).toBe(0);
  });

  it('includes gender in prompt when provided', async () => {
    const storage = makeMockStorage();
    const provider = makeMockImageProvider();
    const char = { name: 'Aria', class: 'Mage', species: 'Elf', quirk: 'Loves riddles', gender: 'female' };
    const result = await ImageService.generateAvatar(char, 'sess-avatar-gender', false, provider, storage);
    expect(result.prompt).toContain('female');
  });
});

describe('ImageService.generateSessionPreview', () => {
  it('includes party species, class, gender, and sanitized visual quirks without character names', async () => {
    const storage = makeMockStorage();
    const provider = makeMockImageProvider();
    const result = await ImageService.generateSessionPreview({
      id: 'sess-preview-1',
      displayName: 'The Punny Realm',
      worldDescription: 'A moonlit mushroom cave',
      dmPrep: 'A goblin king hoards glowing cheese.',
      dmPrepImageBrief: 'goblin king, glowing cheese artifact, mushroom cave throne',
      party: [
        { name: 'Pip', class: 'Rogue', species: 'Halfling', quirk: 'talks to books', gender: 'female' },
        { name: 'Zara', class: 'Wizard', species: 'Elf', quirk: 'collects cursed spoons' },
      ],
    }, false, provider, storage);

    expect(result).not.toBeNull();
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toContain('female Halfling Rogue with a curious scholarly aura and expressive theatrical posture');
    expect(provider.calls[0]).toContain('Elf Wizard with small gleaming trinkets and subtle magical aura');
    expect(provider.calls[0]).toContain('goblin king, glowing cheese artifact, mushroom cave throne');
    expect(provider.calls[0]).toContain('full-bleed');
    expect(provider.calls[0]).not.toContain('talks to books');
    expect(provider.calls[0]).not.toContain('collects cursed spoons');
    expect(provider.calls[0]).not.toContain('storybook');
    expect(provider.calls[0]).not.toContain('Pip');
    expect(provider.calls[0]).not.toContain('Zara');
    expect(provider.calls[0]).not.toContain('The Punny Realm');
  });
});

describe('ImageService.generateInitialsSvg', () => {
  it('produces correct two-word initials', () => {
    const svgUrl = ImageService.generateInitialsSvg('Barnaby Foxwick', 'sess-svg-1');
    const filePath = path.join(TEST_IMG_DIR, `avatar_initials_sess-svg-1_Barnaby_Foxwick.svg`);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toContain('>BF<');
    expect(svgUrl).toContain('avatar_initials_sess-svg-1_Barnaby_Foxwick.svg');
  });

  it('produces first-two-chars initials for single-word name', () => {
    ImageService.generateInitialsSvg('Zomgush', 'sess-svg-2');
    const content = fs.readFileSync(path.join(TEST_IMG_DIR, `avatar_initials_sess-svg-2_Zomgush.svg`), 'utf8');
    expect(content).toContain('>ZO<');
  });

  it('produces valid SVG markup and URL with configured base path', () => {
    const svgUrl = ImageService.generateInitialsSvg('Test Hero', 'sess-svg-3');
    const content = fs.readFileSync(path.join(TEST_IMG_DIR, `avatar_initials_sess-svg-3_Test_Hero.svg`), 'utf8');
    expect(content).toContain('<svg');
    expect(content).toContain('</svg>');
    expect(content).toContain('<polygon');
    expect(content).toContain('<text');
    expect(svgUrl).toMatch(/^\/test-images\//);
  });
});

describe('ImageService.getDefaultImage', () => {
  it('returns the fallback path', () => {
    expect(ImageService.getDefaultImage()).toBe('/images/default_scene.png');
  });
});
