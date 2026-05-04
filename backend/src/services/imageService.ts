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

type ImageCharacterContext = {
  id?: string;
  class: string;
  species: string;
  quirk?: string;
  gender?: string;
  status?: string;
};

export type SceneImageContext = {
  worldDescription?: string;
  dmPrepImageBrief?: string;
  party?: ImageCharacterContext[];
  activeCharacterId?: string;
  currentTensionLevel?: string;
};

const IMAGE_COMPOSITION_GUARDRAIL = [
  'Finished standalone fantasy illustration.',
  'Single edge-to-edge image filling the square canvas.',
  'Continuous painted scene only, not a book page, parchment sheet, manuscript, title card, poster, trading card, gallery mat, or framed illustration.',
  'One shared camera view with every figure occupying the same physical environment.',
  'Only the described characters, creatures, props, and environment are visible.',
  'Blank unmarked surfaces; no readable symbols or markings.',
  'No captions, lettering, logos, borders, mats, picture frames, panels, split views, grids, contact sheets, character sheets, portrait cards, labels under figures, header bands, footer bands, blank margins, menus, toolbars, editor controls, crop handles, selection boxes, rulers, guides, or software interface elements.',
].join(' ');

export const IMAGE_PROMPT_STYLE = {
  avatar: 'Digital fantasy art, painterly detail, centered portrait composition.',
  scene: 'Fantasy scene illustration, detailed fantasy art, cinematic lighting, vibrant colors.',
  preview: 'Painterly fantasy adventure art, cinematic lighting, vibrant colors, full-bleed landscape composition with no margins.',
} as const;

function sanitizeVisualPrompt(prompt: string): string {
  return prompt
    .replace(/\b(readable\s+)?(text|words?|letters?|numbers?|captions?|labels?|headlines?|titles?|typography|font|writing|written\s+text)\b/gi, 'plain unmarked visual detail')
    .replace(/\b(signboards?|signs?|plaques?|inscriptions?|carved\s+writing|book\s+pages?)\b/gi, 'unmarked weathered surfaces')
    .replace(/\b(runes?|glyphs?|sigils?|symbols?)\b/gi, 'abstract magical glow')
    .replace(/\b(scrolls?)\b/gi, 'blank parchment')
    .replace(/\b(maps?)\b/gi, 'unmarked parchment chart')
    .replace(/\b(banners?)\b/gi, 'plain cloth standards')
    .replace(/\b(UI|interface|menus?|toolbars?|panels?|sliders?|crop\s+handles?|selection\s+boxes?|rulers?|guides?|editing\s+controls?|image\s+editor|photoshop)\b/gi, 'finished artwork composition')
    .replace(/\b(picture\s+frames?|photo\s+frames?|borders?|mats?|caption\s+bands?|page\s+layout|poster\s+layout|split\s+views?|collage|diptych|triptych)\b/gi, 'edge-to-edge scene composition');
}

export function buildImagePrompt(subject: string, style: string): string {
  return `${IMAGE_COMPOSITION_GUARDRAIL} ${sanitizeVisualPrompt(subject).trim()} ${style}`;
}

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
    const visualQuirk = this.getSafeVisualQuirk(char.quirk);
    const quirkPart = visualQuirk ? ` The portrait includes ${visualQuirk}.` : '';
    const prompt = buildImagePrompt(
      `Close-up portrait of a ${genderDesc}${char.species.toLowerCase()} ${char.class.toLowerCase()} fantasy RPG character on a dark atmospheric background with dramatic rim lighting.${quirkPart}`,
      IMAGE_PROMPT_STYLE.avatar,
    );
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
    context?: SceneImageContext,
  ): Promise<ImageResult | null> {
    const finalPrompt = this.buildSceneImagePrompt(prompt, context);
    const promptHash = crypto.createHash('md5').update(finalPrompt).digest('hex');
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
        prompt: finalPrompt,
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
        return this.generateSanitizedImage(prompt, sessionId, turn, useLocalAI, overrideImageProvider, overrideStorageProvider, context);
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
    context?: SceneImageContext,
  ): Promise<ImageResult | null> {
    const sanitized = this.sanitizePrompt(originalPrompt);
    const finalPrompt = this.buildSceneImagePrompt(`Family-friendly adventure moment: ${sanitized}`, context);
    const promptHash = crypto.createHash('md5').update(finalPrompt).digest('hex');
    const fileName = `${sessionId}_turn${turn}_${promptHash}_safe.png`;
    const storage = overrideStorageProvider ?? getImageStorageProvider();
    const config = getConfig();

    try {
      console.log('Before image provider');
      const imageProvider = overrideImageProvider ?? createImageProvider(useLocalAI);
      console.log('After image provider generating');
      const result = await imageProvider.generateImage({
        prompt: finalPrompt,
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
      dmPrepImageBrief?: string;
      difficulty?: string;
      gameMode?: string;
      party: { name: string; class: string; species: string; quirk?: string; gender?: string }[];
    },
    useLocalAI?: boolean,
    overrideImageProvider?: ImageProvider,
    overrideStorageProvider?: ImageStorageProvider,
  ): Promise<ImageResult | null> {
    const heroList = session.party.length > 0
      ? session.party.map(c => {
        const genderPart = c.gender ? `${c.gender} ` : '';
        const visualQuirk = this.getSafeVisualQuirk(c.quirk);
        const quirkPart = visualQuirk ? ` with ${visualQuirk}` : '';
        return `${genderPart}${c.species} ${c.class}${quirkPart}`;
      }).join(', ')
      : 'a lone adventurer';
    const worldPart = session.worldDescription ? ` ${session.worldDescription}.` : '';
    const villainHint = session.dmPrepImageBrief
      ? ` Visual story cues: ${session.dmPrepImageBrief}.`
      : '';
    const moodHint = this.getSessionPreviewMood(session.difficulty, session.gameMode);
    const moodPart = moodHint ? ` Overall atmosphere: ${moodHint}.` : '';
    const prompt = buildImagePrompt(
      `Fantasy realm establishing scene.${worldPart} Several adventurers stand together in the same location as a single group: ${heroList}.${villainHint}${moodPart} Wide establishing shot with detailed scenery and characters integrated naturally into one continuous environment.`,
      `${IMAGE_PROMPT_STYLE.preview} Single unified group scene, not separate portraits.`,
    );

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

  private static buildSceneImagePrompt(prompt: string, context?: SceneImageContext): string {
    const sceneContext = this.buildSceneVisualContext(context);
    const contextPart = sceneContext ? ` Visual continuity: ${sceneContext}.` : '';
    return buildImagePrompt(
      `${prompt}${contextPart}`,
      IMAGE_PROMPT_STYLE.scene,
    );
  }

  private static buildSceneVisualContext(context?: SceneImageContext): string | null {
    if (!context) {
      return null;
    }

    const parts: string[] = [];
    if (context.worldDescription?.trim()) {
      parts.push(`realm atmosphere: ${context.worldDescription.trim()}`);
    }
    if (context.dmPrepImageBrief?.trim()) {
      parts.push(`recurring visual motifs: ${context.dmPrepImageBrief.trim()}`);
    }

    const party = this.describePartyForImage(context.party);
    if (party) {
      parts.push(`party: ${party}`);
    }

    const active = context.party?.find(c => c.id && c.id === context.activeCharacterId);
    const activeDescription = this.describeCharacterForImage(active);
    if (activeDescription) {
      parts.push(`featured adventurer: ${activeDescription}`);
    }

    if (context.currentTensionLevel) {
      parts.push(`${context.currentTensionLevel} tension mood`);
    }

    return parts.length > 0 ? parts.join('; ') : null;
  }

  private static describePartyForImage(party?: ImageCharacterContext[]): string | null {
    if (!party?.length) {
      return null;
    }

    return party
      .slice(0, 5)
      .map(c => this.describeCharacterForImage(c))
      .filter((value): value is string => Boolean(value))
      .join(', ') || null;
  }

  private static describeCharacterForImage(character?: ImageCharacterContext): string | null {
    if (!character) {
      return null;
    }

    const genderPart = character.gender ? `${character.gender} ` : '';
    const visualQuirk = this.getSafeVisualQuirk(character.quirk);
    const quirkPart = visualQuirk ? ` with ${visualQuirk}` : '';
    const statusPart = character.status === 'downed' ? ' looking battered but present' : '';
    return `${genderPart}${character.species} ${character.class}${quirkPart}${statusPart}`;
  }

  private static getSessionPreviewMood(difficulty?: string, gameMode?: string): string | null {
    const cues: string[] = [];

    if (difficulty === 'easy') {
      cues.push('welcoming adventure with bright hopeful lighting');
    } else if (difficulty === 'hard') {
      cues.push('dangerous heroic atmosphere with dramatic shadows');
    }

    if (gameMode === 'fast') {
      cues.push('energetic motion and clear action focus');
    } else if (gameMode === 'cinematic') {
      cues.push('sweeping cinematic scale and dramatic depth');
    } else if (gameMode === 'zug-ma-geddon') {
      cues.push('wild chaotic battlefield energy');
    }

    return cues.length > 0 ? cues.join(', ') : null;
  }

  private static getSafeVisualQuirk(quirk?: string): string | null {
    if (!quirk?.trim()) {
      return null;
    }

    const q = quirk.trim();
    const lower = q.toLowerCase();
    const cues: string[] = [];

    if (/\b(books?|journals?|diar(?:y|ies)|letters?|scrolls?|maps?|signs?|banners?|labels?|inscriptions?|words?|text|writing|writes?|reads?|reading)\b/.test(lower)) {
      cues.push('a curious scholarly aura');
    }
    if (/\b(talks?|speaks?|says?|whispers?|conversation|conversations|riddles?|songs?|sings?|singing|hymns?|voice|voices|names?)\b/.test(lower)) {
      cues.push('expressive theatrical posture');
    }
    if (/\b(shiny|collects?|collecting|steals?|stealing|coins?|spoons?|trinkets?|relics?|artifacts?|gems?|treasure)\b/.test(lower)) {
      cues.push('small gleaming trinkets');
    }
    if (/\b(shadows?|lies?|lying|fire|sparks?|glows?|glowing|magic|curses?|cursed|aura)\b/.test(lower)) {
      cues.push('subtle magical aura');
    }
    if (/\b(axes?|swords?|weapons?|battle|headbutts?|doors?|strong|loud|screams?|screaming|whispers?)\b/.test(lower)) {
      cues.push('bold physical confidence');
    }
    if (/\b(noble|royal|titles?|proud|formal|respect)\b/.test(lower)) {
      cues.push('overdressed noble confidence');
    }
    if (/\b(clumsy|awkward|nervous|shy|timid|scared|fearful|jumpy)\b/.test(lower)) {
      cues.push('slightly nervous posture');
    }
    if (/\b(cheerful|happy|joyful|smiles?|laughs?|laughing|optimistic|friendly)\b/.test(lower)) {
      cues.push('warm cheerful expression');
    }
    if (/\b(grumpy|angry|stern|serious|brooding|moody|suspicious)\b/.test(lower)) {
      cues.push('stern dramatic expression');
    }
    if (/\b(messy|dirty|mud|muddy|patches|patched|ragged|torn|wild|unkempt)\b/.test(lower)) {
      cues.push('weathered adventuring gear');
    }
    if (/\b(food|snacks?|cookies?|cake|cheese|hungry|eats?|eating|cooks?|cooking)\b/.test(lower)) {
      cues.push('small travel snacks tucked into their gear');
    }

    if (cues.length > 0) {
      return Array.from(new Set(cues)).slice(0, 2).join(' and ');
    }

    return 'a distinctive expressive personality';
  }
}
