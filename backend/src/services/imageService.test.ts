import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildImagePrompt, ImageService, IMAGE_PROMPT_STYLE } from './imageService.js';
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
    const result = await ImageService.generateImage('A dragon attacks', 'sess-1', 1, provider, storage);
    expect(result).not.toBeNull();
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toContain('A dragon attacks');
    expect(provider.calls[0]).toContain('Finished standalone fantasy illustration');
    expect(provider.calls[0]).toContain('No text or pseudo-text anywhere in the image');
    expect(provider.calls[0]).toContain('No captions, lettering, numbers, logos');
    expect(provider.calls[0]).toContain('Dungeons and Dragons adventure moment');
    expect(storage.stored.size).toBe(1);
    expect(result!.url).toMatch(/^http:\/\/mock-storage\//);
  });

  it('rewrites text-prone scene props into blank visual props', async () => {
    const storage = makeMockStorage();
    const provider = makeMockImageProvider();
    await ImageService.generateImage('A wizard studies a spellbook beside a map, rune plaque, banner, and character card', 'sess-text-risk', 1, provider, storage);
    const finalPrompt = provider.calls[0];
    expect(finalPrompt).toContain('plain unmarked props');
    expect(finalPrompt).toContain('plain unmarked parchment chart');
    expect(finalPrompt).toContain('abstract magical glow');
    expect(finalPrompt).toContain('plain cloth standards');
    expect(finalPrompt).toContain('plain unmarked tokens');
    expect(finalPrompt).not.toContain('spellbook');
    expect(finalPrompt).not.toContain('rune plaque');
    expect(finalPrompt).not.toContain('beside a map');
    expect(finalPrompt).not.toContain('banner, and character card');
  });

  it('cache hit: skips provider and returns cached URL', async () => {
    const provider = makeMockImageProvider();
    const prompt = 'A dragon attacks';
    const finalPrompt = buildImagePrompt(prompt, IMAGE_PROMPT_STYLE.scene);
    const hash = crypto.createHash('md5').update(finalPrompt).digest('hex');
    const cachedKey = `sess-cached_turn1_${hash}.png`;
    const storage = makeMockStorage(new Set([cachedKey]));
    const result = await ImageService.generateImage(prompt, 'sess-cached', 1, provider, storage);
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
    const result = await ImageService.generateImage('A goblin sneaks', 'sess-fail', 2, failProvider, storage);
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
    const result = await ImageService.generateImage('kill the undead skeleton', 'sess-policy', 3, policyProvider, storage);
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
    const result = await ImageService.generateImage('undead attack', 'sess-double-policy', 4, alwaysFailProvider, storage);
    expect(result).toBeNull();
  });
});

describe('ImageService.generateAvatar', () => {
  it('cache miss: calls provider and stores result', async () => {
    const storage = makeMockStorage();
    const provider = makeMockImageProvider();
    const char = { name: 'Pip', class: 'Rogue', species: 'Halfling', quirk: 'Talks to plants' };
    const result = await ImageService.generateAvatar(char, 'sess-avatar-1', provider, storage);
    expect(result.url).toBeTruthy();
    expect(result.prompt).toContain('halfling rogue');
    expect(result.prompt).toContain('Close-up bust view of one');
    expect(result.prompt).toContain('face and shoulders crop');
    expect(result.prompt).toContain('not a figurine, game piece, card art, printed portrait, framed artwork, or display object');
    expect(result.prompt).toContain('No text or pseudo-text anywhere in the image');
    expect(result.prompt).not.toContain('fantasy RPG character');
    expect(result.prompt).not.toContain('portrait composition');
    expect(provider.calls).toHaveLength(1);
    expect(storage.stored.size).toBe(1);
  });

  it('cache hit: skips provider', async () => {
    const provider = makeMockImageProvider();
    const char = { name: 'Pip', class: 'Rogue', species: 'Halfling', quirk: 'Talks to plants' };
    const prompt = buildImagePrompt(
      `Close-up bust view of one ${char.species.toLowerCase()} ${char.class.toLowerCase()} adventurer standing in a dark atmospheric fantasy location with dramatic rim lighting. Face, shoulders, costume, and expression fill the frame directly. The character visibly has expressive theatrical posture.`,
      IMAGE_PROMPT_STYLE.avatar,
    );
    const hash = crypto.createHash('md5').update(prompt).digest('hex');
    const cachedKey = `avatar_sess-avatar-cached_${char.name}_${hash}.png`;
    const storage = makeMockStorage(new Set([cachedKey]));
    const result = await ImageService.generateAvatar(char, 'sess-avatar-cached', provider, storage);
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
    const result = await ImageService.generateAvatar(char, 'sess-avatar-fail', failProvider, storage);
    expect(result.url).toBeTruthy();
    expect(result.url).toContain('avatar_initials');
    expect(storage.stored.size).toBe(0);
  });

  it('includes gender in prompt when provided', async () => {
    const storage = makeMockStorage();
    const provider = makeMockImageProvider();
    const char = { name: 'Aria', class: 'Mage', species: 'Elf', quirk: 'Loves riddles', gender: 'female' };
    const result = await ImageService.generateAvatar(char, 'sess-avatar-gender', provider, storage);
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
    }, provider, storage);

    expect(result).not.toBeNull();
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toContain('female Halfling Rogue with a curious scholarly aura and expressive theatrical posture');
    expect(provider.calls[0]).toContain('Elf Wizard with small gleaming trinkets and subtle magical aura');
    expect(provider.calls[0]).toContain('goblin king, glowing cheese artifact, mushroom cave throne');
    expect(provider.calls[0]).toContain('full-bleed');
    expect(provider.calls[0]).toContain('No text or pseudo-text anywhere in the image');
    expect(provider.calls[0]).toContain('not a book page, parchment sheet, manuscript, title card, poster, trading card');
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
