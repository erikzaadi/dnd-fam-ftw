import crypto from 'crypto';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { createImageProvider } from '../providers/ai/AiProviderFactory.js';
import { DEFAULT_NEGATIVE_PROMPT } from '../providers/ai/images/ImageProvider.js';
import { getImageStorageProvider } from '../providers/storage/storageProviderFactory.js';
import { getConfig } from '../config/env.js';

export type ImageResult = { url: string; storageKey: string; storageProvider: string };

export class ImageService {
  private static DEFAULT_IMAGE = '/api/images/default_scene.png';

  public static async generateAvatar(
    char: { name: string; class: string; species: string; quirk: string },
    sessionId: string,
    useLocalAI?: boolean,
  ): Promise<{ url: string; prompt: string; storageKey: string; storageProvider: string }> {
    const prompt = `fantasy character portrait, ${char.species} ${char.class}, detailed face, plain dark background, vibrant colors, cinematic lighting, digital illustration`;
    const promptHash = crypto.createHash('md5').update(prompt).digest('hex');
    const fileName = `avatar_${sessionId}_${char.name}_${promptHash}.png`;
    const storage = getImageStorageProvider();
    const config = getConfig();

    if (await storage.exists(fileName)) {
      return { url: storage.getPublicUrl(fileName), prompt, storageKey: fileName, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    }

    try {
      console.log(`[ImageService] Generating avatar for ${char.name}`);
      const avatarStart = Date.now();
      const imageProvider = createImageProvider(useLocalAI);
      const result = await imageProvider.generateImage({
        prompt,
        negativePrompt: DEFAULT_NEGATIVE_PROMPT,
        width: 1024,
        height: 1024,
      });
      console.log(`[ImageService] Avatar for ${char.name} received in ${Date.now() - avatarStart}ms`);

      const buffer = await this.fetchImageBuffer(result.url);
      const stored = await storage.putImage({ key: fileName, contentType: 'image/png', body: buffer, cacheControl: 'public, max-age=31536000, immutable' });
      return { url: stored.publicUrl, prompt, storageKey: stored.key, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    } catch (error) {
      console.error('[ImageService] Avatar generation failed, using initials SVG:', error);
      const svgUrl = this.generateInitialsSvg(char.name, sessionId);
      return { url: svgUrl, prompt, storageKey: '', storageProvider: 'local' };
    }
  }

  public static async generateImage(
    prompt: string,
    sessionId: string,
    turn: number,
    useLocalAI?: boolean,
  ): Promise<ImageResult | null> {
    const promptHash = crypto.createHash('md5').update(prompt).digest('hex');
    const fileName = `${sessionId}_turn${turn}_${promptHash}.png`;
    const storage = getImageStorageProvider();
    const config = getConfig();

    if (await storage.exists(fileName)) {
      return { url: storage.getPublicUrl(fileName), storageKey: fileName, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    }

    try {
      console.log(`[ImageService] Generating image for session ${sessionId}: ${prompt}`);
      const imageProvider = createImageProvider(useLocalAI);
      const result = await imageProvider.generateImage({
        prompt,
        negativePrompt: DEFAULT_NEGATIVE_PROMPT,
        width: 1024,
        height: 1024,
      });

      const buffer = await this.fetchImageBuffer(result.url);
      const stored = await storage.putImage({ key: fileName, contentType: 'image/png', body: buffer, cacheControl: 'public, max-age=31536000, immutable' });
      return { url: stored.publicUrl, storageKey: stored.key, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'content_policy_violation') {
        console.warn('[ImageService] Content policy hit, retrying with sanitized prompt');
        return this.generateSanitizedImage(prompt, sessionId, turn, useLocalAI);
      }
      console.error('[ImageService] Error generating image:', error);
      return null;
    }
  }

  private static async fetchImageBuffer(imageUrl: string): Promise<Buffer> {
    if (imageUrl.startsWith('data:')) {
      const base64 = imageUrl.split(',')[1];
      return Buffer.from(base64, 'base64');
    }
    const res = await axios.get<ArrayBuffer>(imageUrl, { responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  }

  private static sanitizePrompt(prompt: string): string {
    return prompt
      .replace(/\bundead\b/gi, 'spectral')
      .replace(/\bcorpse[s]?\b/gi, 'shadowy figure')
      .replace(/\bzombie[s]?\b/gi, 'cursed warrior')
      .replace(/\bskeleton[s]?\b/gi, 'skeletal warrior')
      .replace(/\bgore\b/gi, 'chaos')
      .replace(/\bblood(y|ied)?\b/gi, 'intense')
      .replace(/\bkill(s|ed|ing)?\b/gi, 'defeats')
      .replace(/\bdeath\b/gi, 'shadow')
      .replace(/\bstrike[s]?\b/gi, 'clashes')
      .replace(/\bslaughter\b/gi, 'battle')
      .replace(/\bmutilat\w+/gi, 'intense fight');
  }

  private static async generateSanitizedImage(
    originalPrompt: string,
    sessionId: string,
    turn: number,
    useLocalAI?: boolean,
  ): Promise<ImageResult | null> {
    const sanitized = this.sanitizePrompt(originalPrompt);
    const promptHash = crypto.createHash('md5').update(sanitized).digest('hex');
    const fileName = `${sessionId}_turn${turn}_${promptHash}_safe.png`;
    const storage = getImageStorageProvider();
    const config = getConfig();

    try {
      console.log('Before image provider');
      const imageProvider = createImageProvider(useLocalAI);
      console.log('After image provider generating');
      const result = await imageProvider.generateImage({
        prompt: `family-friendly, ${sanitized}`,
        negativePrompt: DEFAULT_NEGATIVE_PROMPT,
        width: 1024,
        height: 1024,
      });
      const buffer = await this.fetchImageBuffer(result.url);
      const stored = await storage.putImage({ key: fileName, contentType: 'image/png', body: buffer, cacheControl: 'public, max-age=31536000, immutable' });
      return { url: stored.publicUrl, storageKey: stored.key, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    } catch {
      console.warn('[ImageService] Sanitized image also failed, using default.');
      return null;
    }
  }

  // Initials SVG avatars are always written locally and served by the backend,
  // regardless of the image storage provider. They are tiny and act as a fallback.
  public static generateInitialsSvg(name: string, sessionId: string): string {
    const words = name.trim().split(/\s+/);
    const initials = words.length >= 2
      ? (words[0][0] + words[1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();

    const colors = ['#b45309', '#7c3aed', '#0f766e', '#1d4ed8', '#be185d', '#15803d'];
    const color = colors[name.charCodeAt(0) % colors.length];

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <rect width="100" height="100" rx="16" fill="#0f172a"/>
  <polygon points="50,8 88,28 88,72 50,92 12,72 12,28" fill="${color}22" stroke="${color}" stroke-width="2"/>
  <text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="32" font-weight="900" fill="${color}" font-family="sans-serif">${initials}</text>
</svg>`;

    const config = getConfig();
    const storageDir = path.resolve(config.LOCAL_IMAGE_STORAGE_PATH);
    fs.mkdirSync(storageDir, { recursive: true });
    const fileName = `avatar_initials_${sessionId}_${name.replace(/\s+/g, '_')}.svg`;
    fs.writeFileSync(path.join(storageDir, fileName), svg, 'utf8');
    return `${config.LOCAL_IMAGE_PUBLIC_BASE_URL}/${fileName}`;
  }

  public static getDefaultImage(): string {
    return this.DEFAULT_IMAGE;
  }
}
