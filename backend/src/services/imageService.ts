import crypto from 'crypto';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { createImageProvider } from '../providers/ai/AiProviderFactory.js';
import { DEFAULT_NEGATIVE_PROMPT, type ImageProvider } from '../providers/ai/images/ImageProvider.js';
import { getImageStorageProvider } from '../providers/storage/storageProviderFactory.js';
import type { ImageStorageProvider } from '../providers/storage/ImageStorageProvider.js';
import { getConfig } from '../config/env.js';

export type ImageResult = { url: string; storageKey: string; storageProvider: string };

export class ImageService {
  private static DEFAULT_IMAGE = '/images/default_scene.png';

  public static async generateAvatar(
    char: { name: string; class: string; species: string; quirk: string; gender?: string },
    sessionId: string,
    useLocalAI?: boolean,
    overrideImageProvider?: ImageProvider,
    overrideStorageProvider?: ImageStorageProvider,
  ): Promise<{ url: string; prompt: string; storageKey: string; storageProvider: string }> {
    const genderDesc = char.gender ? `${char.gender} ` : '';
    const nameDesc = char.name ? `, visual personality inspired by the character name "${char.name}" but do not write the name` : '';
    const quirkDesc = char.quirk ? `, subtle visual personality cue: ${char.quirk}` : '';
    const prompt = `single finished fantasy character portrait of one ${genderDesc}${char.species} ${char.class}${nameDesc}${quirkDesc}, one subject only, one face only, single uninterrupted image, no split screen, no side-by-side panels, no duplicate portrait, detailed face, centered head-and-shoulders composition, plain dark background, vibrant colors, cinematic lighting, painterly storybook art, no interface, no editor controls, no crop guides, no grid lines, no color palettes, no overlays, no text or writing`;
    const promptHash = crypto.createHash('md5').update(prompt).digest('hex');
    const fileName = `avatar_${sessionId}_${char.name}_${promptHash}.png`;
    const storage = overrideStorageProvider ?? getImageStorageProvider();
    const config = getConfig();

    if (await storage.exists(fileName)) {
      return { url: storage.getPublicUrl(fileName), prompt, storageKey: fileName, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    }

    try {
      console.log(`[ImageService] Generating avatar for ${char.name}`);
      const avatarStart = Date.now();
      const imageProvider = overrideImageProvider ?? createImageProvider(useLocalAI);
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
    overrideImageProvider?: ImageProvider,
    overrideStorageProvider?: ImageStorageProvider,
  ): Promise<ImageResult | null> {
    const promptHash = crypto.createHash('md5').update(prompt).digest('hex');
    const fileName = `${sessionId}_turn${turn}_${promptHash}.png`;
    const storage = overrideStorageProvider ?? getImageStorageProvider();
    const config = getConfig();

    if (await storage.exists(fileName)) {
      return { url: storage.getPublicUrl(fileName), storageKey: fileName, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    }

    try {
      console.log(`[ImageService] Generating image for session ${sessionId}: ${prompt}`);
      const imageProvider = overrideImageProvider ?? createImageProvider(useLocalAI);
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
        return this.generateSanitizedImage(prompt, sessionId, turn, useLocalAI, overrideImageProvider, overrideStorageProvider);
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
    overrideImageProvider?: ImageProvider,
    overrideStorageProvider?: ImageStorageProvider,
  ): Promise<ImageResult | null> {
    const sanitized = this.sanitizePrompt(originalPrompt);
    const promptHash = crypto.createHash('md5').update(sanitized).digest('hex');
    const fileName = `${sessionId}_turn${turn}_${promptHash}_safe.png`;
    const storage = overrideStorageProvider ?? getImageStorageProvider();
    const config = getConfig();

    try {
      console.log('Before image provider');
      const imageProvider = overrideImageProvider ?? createImageProvider(useLocalAI);
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

  public static async generateSessionPreview(
    session: {
      id: string;
      displayName: string;
      worldDescription?: string;
      dmPrep?: string;
      party: { name: string; class: string; species: string; quirk?: string; gender?: string }[];
    },
    useLocalAI?: boolean,
    overrideImageProvider?: ImageProvider,
    overrideStorageProvider?: ImageStorageProvider,
  ): Promise<ImageResult | null> {
    const heroList = session.party.length > 0
      ? session.party.map(c => {
        const genderPart = c.gender ? `${c.gender} ` : '';
        const quirkPart = c.quirk ? ` with ${c.quirk}` : '';
        return `${genderPart}${c.species} ${c.class}${quirkPart}`;
      }).join(', ')
      : 'a lone adventurer';
    const worldPart = session.worldDescription ? ` ${session.worldDescription}.` : '';
    const villainHint = session.dmPrep
      ? ' ' + session.dmPrep.slice(0, 120).replace(/\n/g, ' ').trim() + '.'
      : '';
    const prompt = `Fantasy adventure establishing scene for a realm.${worldPart} Adventuring party: ${heroList}.${villainHint} Purely visual artwork with no text, no signs, no plaques, no banners, no maps, no books, no scrolls, and no inscriptions. Wide establishing shot, cinematic lighting, storybook art, detailed environment`;

    const promptHash = crypto.createHash('md5').update(prompt).digest('hex');
    const fileName = `preview_${session.id}_${promptHash}.png`;
    const storage = overrideStorageProvider ?? getImageStorageProvider();
    const config = getConfig();

    if (await storage.exists(fileName)) {
      return { url: storage.getPublicUrl(fileName), storageKey: fileName, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    }

    try {
      console.log(`[ImageService] Generating session preview for ${session.displayName}`);
      const imageProvider = overrideImageProvider ?? createImageProvider(useLocalAI);
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
        const sanitizedPrompt = this.sanitizePrompt(prompt);
        return this.generateImage(sanitizedPrompt, session.id, 0, useLocalAI, overrideImageProvider, overrideStorageProvider);
      }
      console.error('[ImageService] Session preview generation failed:', error);
      return null;
    }
  }

  public static getDefaultImage(): string {
    return this.DEFAULT_IMAGE;
  }
}
