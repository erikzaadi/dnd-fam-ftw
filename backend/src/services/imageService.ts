import crypto from 'crypto';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createImageProvider } from '../ai/AiProviderFactory.js';
import { DEFAULT_NEGATIVE_PROMPT } from '../ai/images/ImageProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ImageService {
  private static PUBLIC_DIR = path.join(__dirname, '..', '..', 'public', 'images');
  private static DEFAULT_IMAGE = '/api/images/default_scene.png';

  public static async generateAvatar(
    char: { name: string; class: string; species: string; quirk: string },
    sessionId: string,
    useLocalAI?: boolean,
  ): Promise<{ url: string; prompt: string }> {
    const prompt = `fantasy character portrait, ${char.species} ${char.class}, detailed face, plain dark background, vibrant colors, cinematic lighting, digital illustration`;
    const promptHash = crypto.createHash('md5').update(prompt).digest('hex');
    const fileName = `avatar_${sessionId}_${char.name}_${promptHash}.png`;
    const localPath = path.join(this.PUBLIC_DIR, fileName);
    const publicUrl = `/api/images/${fileName}`;

    if (fs.existsSync(localPath)) {
      return { url: publicUrl, prompt };
    }

    try {
      console.log(`[ImageService] Generating avatar for ${char.name}`);
      const avatarStart = Date.now();
      const provider = createImageProvider(useLocalAI);
      const result = await provider.generateImage({
        prompt,
        negativePrompt: DEFAULT_NEGATIVE_PROMPT,
        width: 1024,
        height: 1024,
      });
      console.log(`[ImageService] Avatar for ${char.name} received in ${Date.now() - avatarStart}ms`);

      await this.downloadAndSave(result.url, localPath);
      return { url: publicUrl, prompt };
    } catch (error) {
      console.error('[ImageService] Avatar generation failed, using initials SVG:', error);
      return { url: this.generateInitialsSvg(char.name, sessionId), prompt };
    }
  }

  public static async generateImage(
    prompt: string,
    sessionId: string,
    turn: number,
    useLocalAI?: boolean,
  ): Promise<string | null> {
    const promptHash = crypto.createHash('md5').update(prompt).digest('hex');
    const fileName = `${sessionId}_turn${turn}_${promptHash}.png`;
    const localPath = path.join(this.PUBLIC_DIR, fileName);
    const publicUrl = `/api/images/${fileName}`;

    if (fs.existsSync(localPath)) {
      return publicUrl;
    }

    try {
      console.log(`[ImageService] Generating image for session ${sessionId}: ${prompt}`);
      const provider = createImageProvider(useLocalAI);
      const result = await provider.generateImage({
        prompt,
        negativePrompt: DEFAULT_NEGATIVE_PROMPT,
        width: 1024,
        height: 1024,
      });

      await this.downloadAndSave(result.url, localPath);
      return publicUrl;
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'content_policy_violation') {
        console.warn(`[ImageService] Content policy hit, retrying with sanitized prompt`);
        return this.generateSanitizedImage(prompt, sessionId, turn, useLocalAI);
      }
      console.error('[ImageService] Error generating image:', error);
      return this.DEFAULT_IMAGE;
    }
  }

  private static async downloadAndSave(imageUrl: string, localPath: string): Promise<void> {
    // base64 data URL from LocalAI
    if (imageUrl.startsWith('data:')) {
      const base64 = imageUrl.split(',')[1];
      fs.writeFileSync(localPath, Buffer.from(base64, 'base64'));
      return;
    }

    return new Promise((resolve, reject) => {
      axios.get(imageUrl, { responseType: 'stream' }).then(res => {
        const writer = fs.createWriteStream(localPath);
        res.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      }).catch(reject);
    });
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
  ): Promise<string> {
    const sanitized = this.sanitizePrompt(originalPrompt);
    const promptHash = crypto.createHash('md5').update(sanitized).digest('hex');
    const fileName = `${sessionId}_turn${turn}_${promptHash}_safe.png`;
    const localPath = path.join(this.PUBLIC_DIR, fileName);
    const publicUrl = `/api/images/${fileName}`;

    try {
      const provider = createImageProvider(useLocalAI);
      const result = await provider.generateImage({
        prompt: `family-friendly, ${sanitized}`,
        negativePrompt: DEFAULT_NEGATIVE_PROMPT,
        width: 1024,
        height: 1024,
      });
      await this.downloadAndSave(result.url, localPath);
      return publicUrl;
    } catch {
      console.warn('[ImageService] Sanitized image also failed, using default.');
      return this.DEFAULT_IMAGE;
    }
  }

  private static generateInitialsSvg(name: string, sessionId: string): string {
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

    const fileName = `avatar_initials_${sessionId}_${name.replace(/\s+/g, '_')}.svg`;
    const localPath = path.join(this.PUBLIC_DIR, fileName);
    fs.writeFileSync(localPath, svg, 'utf8');
    return `/api/images/${fileName}`;
  }

  public static getDefaultImage(): string {
    return this.DEFAULT_IMAGE;
  }
}
