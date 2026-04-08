import OpenAI from 'openai';
import dotenv from 'dotenv';
import crypto from 'crypto';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: '../.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class ImageService {
  private static PUBLIC_DIR = path.join(__dirname, '..', '..', 'public', 'images');
  private static DEFAULT_IMAGE = '/api/images/default_scene.png';

  public static async generateAvatar(char: { name: string, class: string, species: string, quirk: string }, sessionId: string): Promise<{ url: string, prompt: string }> {
    const prompt = `A portrait of ${char.name}, a ${char.species} ${char.class} who is ${char.quirk}. Fantasy art style, detailed character portrait, minimalist background, no text, no letters, no words.`;
    const promptHash = crypto.createHash('md5').update(prompt).digest('hex');
    const fileName = `avatar_${sessionId}_${char.name}_${promptHash}.png`;
    const localPath = path.join(this.PUBLIC_DIR, fileName);
    const publicUrl = `/api/images/${fileName}`;

    if (fs.existsSync(localPath)) {
      return { url: publicUrl, prompt };
    }

    try {
      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: `NO TEXT. NO WORDS. NO LETTERS. NO WRITING OF ANY KIND. Fantasy portrait illustration only: ${prompt}. Purely graphical illustration with zero text, zero captions, zero labels, zero handwriting, zero logos, zero watermarks. Clear sharp character details.`,
        n: 1,
        size: "1024x1024",
      });

      const imageUrl = response.data && response.data[0] ? response.data[0].url : null;
      if (!imageUrl) {
        return { url: this.DEFAULT_IMAGE, prompt };
      }

      const imageRes = await axios.get(imageUrl, { responseType: 'stream' });
      const writer = fs.createWriteStream(localPath);
      imageRes.data.pipe(writer);

      return new Promise((resolve) => {
        writer.on('finish', () => resolve({ url: publicUrl, prompt }));
        writer.on('error', () => resolve({ url: this.DEFAULT_IMAGE, prompt }));
      });
    } catch (error) {
      console.error("Error generating avatar:", error);
      return { url: this.DEFAULT_IMAGE, prompt };
    }
  }

  public static async generateImage(prompt: string, sessionId: string, sceneId: string): Promise<string | null> {
    const promptHash = crypto.createHash('md5').update(prompt).digest('hex');
    const fileName = `${sessionId}_${sceneId}_${promptHash}.png`;
    const localPath = path.join(this.PUBLIC_DIR, fileName);
    const publicUrl = `/api/images/${fileName}`;

    // 1. Check if already exists locally
    if (fs.existsSync(localPath)) {
      return publicUrl;
    }

    try {
      console.log(`Generating image for session ${sessionId}: ${prompt}`);
      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: `Fantasy style, vibrant colors: ${prompt}`,
        n: 1,
        size: "1024x1024",
      });

      const imageUrl = response.data && response.data[0] ? response.data[0].url : null;
      if (!imageUrl) {
        return this.DEFAULT_IMAGE;
      }

      // 2. Download and save locally
      const imageRes = await axios.get(imageUrl, { responseType: 'stream' });
      const writer = fs.createWriteStream(localPath);
      imageRes.data.pipe(writer);

      return new Promise((resolve) => {
        writer.on('finish', () => resolve(publicUrl));
        writer.on('error', () => resolve(this.DEFAULT_IMAGE));
      });
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'content_policy_violation') {
        console.warn(`Image content policy hit, retrying with sanitized prompt: "${prompt.substring(0, 80)}..."`);
        return this.generateSanitizedImage(prompt, localPath, publicUrl);
      }
      console.error("Error generating image:", error);
      return this.DEFAULT_IMAGE;
    }
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

  private static async generateSanitizedImage(originalPrompt: string, localPath: string, publicUrl: string): Promise<string> {
    const sanitized = this.sanitizePrompt(originalPrompt);
    try {
      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: `Fantasy style, vibrant colors, family-friendly: ${sanitized}`,
        n: 1,
        size: "1024x1024",
      });
      const imageUrl = response.data?.[0]?.url;
      if (!imageUrl) return this.DEFAULT_IMAGE;

      const imageRes = await axios.get(imageUrl, { responseType: 'stream' });
      const writer = fs.createWriteStream(localPath);
      imageRes.data.pipe(writer);
      return new Promise((resolve) => {
        writer.on('finish', () => resolve(publicUrl));
        writer.on('error', () => resolve(this.DEFAULT_IMAGE));
      });
    } catch {
      console.warn(`Sanitized image also rejected, using default.`);
      return this.DEFAULT_IMAGE;
    }
  }

  public static getDefaultImage(): string {
    return this.DEFAULT_IMAGE;
  }
}
