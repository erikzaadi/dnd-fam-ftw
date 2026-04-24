import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { ImageService } from './imageService.js';
import type { ImageProvider } from '../providers/ai/images/ImageProvider.js';
import type { ImageStorageProvider, StoredImage } from '../providers/storage/ImageStorageProvider.js';

// Set env vars before any service method is called.
// getConfig() is lazily cached, so these are picked up on first use.
const TEST_IMG_DIR = path.join(os.tmpdir(), `dnd-test-imgs-${Date.now()}`);
process.env.LOCAL_IMAGE_STORAGE_PATH = TEST_IMG_DIR;
process.env.LOCAL_IMAGE_PUBLIC_BASE_URL = '/test-images';
process.env.IMAGE_STORAGE_PROVIDER = 'local';
process.env.SQLITE_DB_PATH = path.join(os.tmpdir(), `dnd-test-state-img-${Date.now()}.sqlite`);

// Minimal valid PNG as a data URL (1x1 transparent pixel).
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

console.log('Testing ImageService...');

// ── generateImage ─────────────────────────────────────────────────────────────

// Test 1: generateImage cache miss - calls provider and stores result
console.log('Test 1: generateImage cache miss calls provider and stores...');
{
  const storage = makeMockStorage();
  const provider = makeMockImageProvider();
  const result = await ImageService.generateImage('A dragon attacks', 'sess-1', 1, false, provider, storage);
  if (!result) {
    throw new Error('Expected a result, got null');
  }
  if (provider.calls.length !== 1) {
    throw new Error(`Expected 1 provider call, got ${provider.calls.length}`);
  }
  if (!provider.calls[0].includes('A dragon attacks')) {
    throw new Error(`Expected prompt to contain 'A dragon attacks', got '${provider.calls[0]}'`);
  }
  if (storage.stored.size !== 1) {
    throw new Error(`Expected 1 stored image, got ${storage.stored.size}`);
  }
  if (!result.url.startsWith('http://mock-storage/')) {
    throw new Error(`Unexpected URL: ${result.url}`);
  }
  console.log('- Provider called once, image stored, URL returned ✓');
}

// Test 2: generateImage cache hit - returns cached URL without calling provider
console.log('Test 2: generateImage cache hit skips provider...');
{
  const provider = makeMockImageProvider();
  const prompt = 'A dragon attacks';
  const hash = crypto.createHash('md5').update(prompt).digest('hex');
  const cachedKey = `sess-cached_turn1_${hash}.png`;
  const storage = makeMockStorage(new Set([cachedKey]));
  const result = await ImageService.generateImage(prompt, 'sess-cached', 1, false, provider, storage);
  if (!result) {
    throw new Error('Expected a cached result');
  }
  if (provider.calls.length !== 0) {
    throw new Error(`Expected 0 provider calls (cache hit), got ${provider.calls.length}`);
  }
  if (!result.url.includes(cachedKey)) {
    throw new Error(`Expected URL to contain '${cachedKey}', got '${result.url}'`);
  }
  console.log('- Cache hit: provider not called, cached URL returned ✓');
}

// Test 3: generateImage provider failure returns null
console.log('Test 3: generateImage returns null on provider failure...');
{
  const storage = makeMockStorage();
  const failProvider: ImageProvider = {
    generateImage: async (): Promise<{ url: string }> => {
      throw new Error('Provider exploded');
    },
  };
  const result = await ImageService.generateImage('A goblin sneaks', 'sess-fail', 2, false, failProvider, storage);
  if (result !== null) {
    throw new Error('Expected null on provider failure');
  }
  console.log('- Returns null on failure ✓');
}

// Test 4: generateImage content_policy_violation retries with sanitized prompt
console.log('Test 4: generateImage retries with sanitized prompt on content_policy_violation...');
{
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
  if (!result) {
    throw new Error('Expected a result after sanitized retry');
  }
  if (callCount !== 2) {
    throw new Error(`Expected 2 provider calls (original + retry), got ${callCount}`);
  }
  const sanitizedPrompt = receivedPrompts[1];
  if (sanitizedPrompt.includes('undead')) {
    throw new Error(`Sanitized prompt should not contain 'undead': ${sanitizedPrompt}`);
  }
  if (sanitizedPrompt.includes('skeleton')) {
    throw new Error(`Sanitized prompt should not contain 'skeleton': ${sanitizedPrompt}`);
  }
  if (sanitizedPrompt.includes('kill')) {
    throw new Error(`Sanitized prompt should not contain 'kill': ${sanitizedPrompt}`);
  }
  console.log('- Content policy: retried with sanitized prompt ✓');
}

// Test 5: generateImage returns null if sanitized retry also fails
console.log('Test 5: generateImage returns null if sanitized retry also fails...');
{
  const storage = makeMockStorage();
  const alwaysFailProvider: ImageProvider = {
    generateImage: async (): Promise<{ url: string }> => {
      const err = new Error('Content policy') as Error & { code: string };
      err.code = 'content_policy_violation';
      throw err;
    },
  };
  const result = await ImageService.generateImage('undead attack', 'sess-double-policy', 4, false, alwaysFailProvider, storage);
  if (result !== null) {
    throw new Error('Expected null when both original and sanitized calls fail');
  }
  console.log('- Returns null when both original and retry fail ✓');
}

// ── generateAvatar ────────────────────────────────────────────────────────────

// Test 6: generateAvatar cache miss - calls provider and stores
console.log('Test 6: generateAvatar cache miss calls provider and stores...');
{
  const storage = makeMockStorage();
  const provider = makeMockImageProvider();
  const char = { name: 'Pip', class: 'Rogue', species: 'Halfling', quirk: 'Talks to plants' };
  const result = await ImageService.generateAvatar(char, 'sess-avatar-1', false, provider, storage);
  if (!result.url) {
    throw new Error('Expected a URL');
  }
  if (!result.prompt.includes('Halfling Rogue')) {
    throw new Error(`Prompt should mention species/class, got: ${result.prompt}`);
  }
  if (provider.calls.length !== 1) {
    throw new Error(`Expected 1 provider call, got ${provider.calls.length}`);
  }
  if (storage.stored.size !== 1) {
    throw new Error(`Expected 1 stored image, got ${storage.stored.size}`);
  }
  console.log(`- Avatar generated, prompt='${result.prompt}' ✓`);
}

// Test 7: generateAvatar cache hit - skips provider
console.log('Test 7: generateAvatar cache hit skips provider...');
{
  const provider = makeMockImageProvider();
  const char = { name: 'Pip', class: 'Rogue', species: 'Halfling', quirk: 'Talks to plants' };
  const prompt = `fantasy character portrait, ${char.species} ${char.class}, detailed face, plain dark background, vibrant colors, cinematic lighting, digital illustration`;
  const hash = crypto.createHash('md5').update(prompt).digest('hex');
  const cachedKey = `avatar_sess-avatar-cached_${char.name}_${hash}.png`;
  const storage = makeMockStorage(new Set([cachedKey]));
  const result = await ImageService.generateAvatar(char, 'sess-avatar-cached', false, provider, storage);
  if (provider.calls.length !== 0) {
    throw new Error(`Expected 0 provider calls (cache hit), got ${provider.calls.length}`);
  }
  if (!result.url.includes(cachedKey)) {
    throw new Error(`Expected URL to contain '${cachedKey}', got '${result.url}'`);
  }
  console.log('- Avatar cache hit: provider not called ✓');
}

// Test 8: generateAvatar provider failure falls back to initials SVG
console.log('Test 8: generateAvatar falls back to initials SVG on provider failure...');
{
  const storage = makeMockStorage();
  const failProvider: ImageProvider = {
    generateImage: async (): Promise<{ url: string }> => {
      throw new Error('Avatar provider exploded');
    },
  };
  const char = { name: 'Zomgush', class: 'Barbarian', species: 'Orc', quirk: 'Hates silence' };
  const result = await ImageService.generateAvatar(char, 'sess-avatar-fail', false, failProvider, storage);
  if (!result.url) {
    throw new Error('Expected a fallback URL');
  }
  if (!result.url.includes('avatar_initials')) {
    throw new Error(`Expected initials SVG URL, got '${result.url}'`);
  }
  if (storage.stored.size !== 0) {
    throw new Error('Failed avatar should not be stored via provider storage');
  }
  console.log(`- Fallback to initials SVG: '${result.url}' ✓`);
}

// Test 9: generateAvatar includes gender in prompt when provided
console.log('Test 9: generateAvatar includes gender in prompt...');
{
  const storage = makeMockStorage();
  const provider = makeMockImageProvider();
  const char = { name: 'Aria', class: 'Mage', species: 'Elf', quirk: 'Loves riddles', gender: 'female' };
  const result = await ImageService.generateAvatar(char, 'sess-avatar-gender', false, provider, storage);
  if (!result.prompt.includes('female')) {
    throw new Error(`Prompt should contain gender 'female', got: ${result.prompt}`);
  }
  console.log('- Gender included in avatar prompt ✓');
}

// ── generateInitialsSvg ───────────────────────────────────────────────────────

// Test 10: generateInitialsSvg produces correct two-word initials
console.log('Test 10: generateInitialsSvg produces correct initials for two-word name...');
{
  const svgUrl = ImageService.generateInitialsSvg('Barnaby Foxwick', 'sess-svg-1');
  const fileName = `avatar_initials_sess-svg-1_Barnaby_Foxwick.svg`;
  const filePath = path.join(TEST_IMG_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`SVG file not found at ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('>BF<')) {
    throw new Error(`Expected initials 'BF' in SVG, got: ${content.slice(0, 200)}`);
  }
  if (!svgUrl.includes(fileName)) {
    throw new Error(`URL should contain filename, got: ${svgUrl}`);
  }
  console.log(`- Initials 'BF' written to SVG ✓`);
}

// Test 11: generateInitialsSvg produces correct single-word initials (first 2 chars)
console.log('Test 11: generateInitialsSvg produces correct initials for single-word name...');
{
  ImageService.generateInitialsSvg('Zomgush', 'sess-svg-2');
  const fileName = `avatar_initials_sess-svg-2_Zomgush.svg`;
  const filePath = path.join(TEST_IMG_DIR, fileName);
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('>ZO<')) {
    throw new Error(`Expected initials 'ZO' in SVG, got: ${content.slice(0, 200)}`);
  }
  console.log('- Single-word name: initials ZO ✓');
}

// Test 12: generateInitialsSvg SVG is well-formed and URL uses configured base path
console.log('Test 12: generateInitialsSvg produces valid SVG markup and correct URL...');
{
  const svgUrl = ImageService.generateInitialsSvg('Test Hero', 'sess-svg-3');
  const fileName = `avatar_initials_sess-svg-3_Test_Hero.svg`;
  const filePath = path.join(TEST_IMG_DIR, fileName);
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('<svg')) {
    throw new Error('Missing <svg> tag');
  }
  if (!content.includes('</svg>')) {
    throw new Error('Missing </svg> closing tag');
  }
  if (!content.includes('<polygon')) {
    throw new Error('Missing hexagon polygon');
  }
  if (!content.includes('<text')) {
    throw new Error('Missing text element');
  }
  if (!svgUrl.startsWith('/test-images/')) {
    throw new Error(`URL should start with /test-images/, got: ${svgUrl}`);
  }
  console.log('- SVG is well-formed, URL uses configured base path ✓');
}

// Test 13: getDefaultImage returns the fallback path
console.log('Test 13: getDefaultImage returns fallback...');
{
  const def = ImageService.getDefaultImage();
  if (def !== '/images/default_scene.png') {
    throw new Error(`Expected '/images/default_scene.png', got '${def}'`);
  }
  console.log(`- Default image: '${def}' ✓`);
}

console.log('\nAll imageService tests passed!');
