import crypto from 'crypto';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { createImageProvider } from '../providers/ai/AiProviderFactory.js';
import type { ImageProvider } from '../providers/ai/images/ImageProvider.js';
import { getImageStorageProvider } from '../providers/storage/storageProviderFactory.js';
import type { ImageStorageProvider } from '../providers/storage/ImageStorageProvider.js';
import { getConfig } from '../config/env.js';

export type ImageResult = { url: string; storageKey: string; storageProvider: string };
type ImageOutputOptions = {
  size: string;
  outputFormat: 'png' | 'jpeg' | 'webp';
  outputCompression?: number;
};

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
  'No text, pseudo-text, glyph rows, fake writing, decorative calligraphy, title blocks, or paragraph-like marks anywhere in the image.',
  'No centered overlay text, no stacked title lines, no subtitle bands, no credit blocks, no menu copy, no label-like marks, and no blank space reserved for words.',
  'Single full-bleed image filling the entire square frame from edge to edge.',
  'Continuous painted in-world scene only, not a book page, parchment sheet, manuscript, illuminated manuscript, title card, poster, trading card, gallery mat, collectible card, tabletop card, character card, or framed illustration.',
  'One shared camera view with every figure occupying the same physical environment.',
  'Only the described characters, creatures, props, and environment are visible.',
  'All books, scrolls, maps, signs, banners, plaques, cards, and carved surfaces are plain blank visual props with no visible marks, lines, alphabets, icons, diagrams, or symbols.',
  'Sky, clouds, water, streets, walls, windows, clothing, armor, and magical effects stay clean and unmarked.',
  'No captions, lettering, numbers, logos, watermarks, signatures, borders, mats, picture frames, panels, split views, grids, tables, stat blocks, character sheets, reference sheets, portrait cards, character cards, name labels under figures, name tags, labels under figures, header bands, footer bands, blank margins, text areas, menus, toolbars, editor controls, crop handles, selection boxes, rulers, guides, or software interface elements.',
  'No artist hands, brushes, paint palettes, color swatches, easels, stretched canvas, linen texture, canvas wrap, painting mounted on wall, artwork displayed in gallery, display box, pedestal base, art supplies, or image-creation process visible.',
  'If the scene includes magic, show it as light, color, particles, mist, or motion only, never as readable marks or floating writing.',
].join(' ');

export const IMAGE_PROMPT_STYLE = {
  avatar: 'Highly detailed digital fantasy adventurer avatar, sharp rendering, extreme tight centered face and shoulders crop. Head, neck, shoulders, costume collar, and expression fill nearly the entire square frame. Simple dark atmospheric background only, no visible room, desk, table, workbench, candles, tools, art supplies, papers, scrolls, books, maps, frames, matting, plaques, callout lines, annotation lines, or reference-sheet layout. The character is a real living being in the image, not a figurine, game piece, card art, printed portrait, framed artwork, or display object.',
  scene: 'Dungeons and Dragons adventure moment, detailed fantasy art, cinematic lighting, vibrant colors, painterly in-world action scene.',
  preview: 'Painterly fantasy adventure art, cinematic lighting, vibrant colors, full-bleed landscape composition with no margins.',
} as const;

const IMAGE_OUTPUT_PRESETS = {
  avatar: { size: '816x816', outputFormat: 'jpeg', outputCompression: 75 },
  scene: { size: '1024x1024', outputFormat: 'jpeg', outputCompression: 80 },
  preview: { size: '1024x1024', outputFormat: 'jpeg', outputCompression: 80 },
  encounterArea: { size: '1024x1024', outputFormat: 'jpeg', outputCompression: 80 },
} as const satisfies Record<string, ImageOutputOptions>;

function sanitizeVisualPrompt(prompt: string): string {
  return prompt
    .replace(/\b(readable\s+)?(text|words?|letters?|numbers?|captions?|labels?|headlines?|titles?|typography|font|writing|written\s+text|paragraphs?|calligraphy|script|scripts)\b/gi, 'plain unmarked visual detail')
    .replace(/\b(signboards?|signs?|plaques?|inscriptions?|carved\s+writing|(?:spell|story|note)?books?|journals?|diar(?:y|ies)|book\s+pages?|manuscripts?|title\s+cards?)\b/gi, 'plain unmarked props')
    .replace(/\b(runes?|glyphs?|sigils?|symbols?|arcane\s+letters?|magic\s+letters?|floating\s+letters?)\b/gi, 'abstract magical glow')
    .replace(/\b(scrolls?)\b/gi, 'blank parchment')
    .replace(/\b(maps?)\b/gi, 'a plain unmarked parchment chart')
    .replace(/\b(banners?)\b/gi, 'plain cloth standards')
    .replace(/\b(cards?|playing\s+cards?|trading\s+cards?|character\s+cards?)\b/gi, 'plain unmarked tokens')
    .replace(/\b(UI|interface|menus?|toolbars?|panels?|sliders?|crop\s+handles?|selection\s+boxes?|rulers?|guides?|editing\s+controls?|image\s+editor|photoshop)\b/gi, 'finished artwork composition')
    .replace(/\b(picture\s+frames?|photo\s+frames?|borders?|mats?|caption\s+bands?|page\s+layout|poster\s+layout|split\s+views?|collage|diptych|triptych)\b/gi, 'edge-to-edge scene composition');
}

export function buildImagePrompt(subject: string, style: string): string {
  return `${IMAGE_COMPOSITION_GUARDRAIL} ${sanitizeVisualPrompt(subject).trim()} ${style} Final image must contain only visual scenery and characters, with zero readable or unreadable text-like marks.`;
}

export class ImageService {
  private static DEFAULT_IMAGE = '/images/default_scene.png';
  private static IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'webp', 'png'] as const;

  private static imageFileName(baseName: string, options: ImageOutputOptions): string {
    return `${baseName}.${options.outputFormat === 'jpeg' ? 'jpg' : options.outputFormat}`;
  }

  private static async findExistingImage(
    baseName: string,
    preferredFileName: string,
    storage: ImageStorageProvider,
  ): Promise<string | null> {
    if (await storage.exists(preferredFileName)) {
      return preferredFileName;
    }

    for (const extension of this.IMAGE_EXTENSIONS) {
      const candidate = `${baseName}.${extension}`;
      if (candidate === preferredFileName) {
        continue;
      }
      if (await storage.exists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private static providerOutputDetails(
    result: Awaited<ReturnType<ImageProvider['generateImage']>>,
    fallback: ImageOutputOptions,
  ): { contentType: string; extension: string } {
    return {
      contentType: result.contentType ?? (fallback.outputFormat === 'jpeg' ? 'image/jpeg' : `image/${fallback.outputFormat}`),
      extension: result.extension ?? (fallback.outputFormat === 'jpeg' ? 'jpg' : fallback.outputFormat),
    };
  }

  private static imageFileNameWithExtension(baseName: string, extension: string): string {
    return `${baseName}.${extension.replace(/^jpeg$/, 'jpg')}`;
  }

  public static async generateAvatar(
    char: { name: string; class: string; species: string; quirk: string; gender?: string },
    sessionId: string,
    overrideImageProvider?: ImageProvider,
    overrideStorageProvider?: ImageStorageProvider,
  ): Promise<{ url: string; prompt: string; storageKey: string; storageProvider: string }> {
    const genderDesc = char.gender ? `${char.gender} ` : '';
    const visualQuirk = this.getSafeVisualQuirk(char.quirk);
    const quirkPart = visualQuirk ? ` The character visibly has ${visualQuirk}.` : '';
    const prompt = buildImagePrompt(
      `Extreme close-up avatar of one ${genderDesc}${char.species.toLowerCase()} ${char.class.toLowerCase()} adventurer facing the camera against a simple dark atmospheric background with dramatic rim lighting. Only the living character's head, shoulders, costume collar, and expression are visible; crop out hands, weapons, tables, surrounding rooms, props, framed art, and display surfaces.${quirkPart}`,
      IMAGE_PROMPT_STYLE.avatar,
    );
    const promptHash = crypto.createHash('md5').update(prompt).digest('hex');
    const outputOptions = IMAGE_OUTPUT_PRESETS.avatar;
    const fileBaseName = `avatar_${sessionId}_${char.name}_${promptHash}`;
    const fileName = this.imageFileName(fileBaseName, outputOptions);
    const storage = overrideStorageProvider ?? getImageStorageProvider();
    const config = getConfig();

    const existingKey = await this.findExistingImage(fileBaseName, fileName, storage);
    if (existingKey) {
      return { url: storage.getPublicUrl(existingKey), prompt, storageKey: existingKey, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    }

    try {
      console.log(`[ImageService] Generating avatar for ${char.name}`);
      const avatarStart = Date.now();
      const imageProvider = overrideImageProvider ?? createImageProvider();
      const result = await imageProvider.generateImage({ prompt, ...outputOptions });
      console.log(`[ImageService] Avatar for ${char.name} received in ${Date.now() - avatarStart}ms`);

      const buffer = await this.fetchImageBuffer(result.url);
      const outputDetails = this.providerOutputDetails(result, outputOptions);
      const stored = await storage.putImage({ key: this.imageFileNameWithExtension(fileBaseName, outputDetails.extension), contentType: outputDetails.contentType, body: buffer, cacheControl: 'public, max-age=31536000, immutable' });
      return { url: stored.publicUrl, prompt, storageKey: stored.key, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    } catch (error) {
      console.error('[ImageService] Avatar generation failed, using initials SVG:', error);
      const svgUrl = this.generateInitialsSvg(char.name, sessionId);
      return { url: svgUrl, prompt, storageKey: '', storageProvider: 'local' };
    }
  }

  public static async generateAreaImage(
    area: { label: string; description?: string; tags?: string[] },
    sessionId: string,
    overrideImageProvider?: ImageProvider,
    overrideStorageProvider?: ImageStorageProvider,
  ): Promise<{ url: string; storageKey: string; storageProvider: string }> {
    const tagDesc = area.tags?.length ? `, ${area.tags.slice(0, 4).join(', ')}` : '';
    const descDetail = area.description?.trim() ? `. ${area.description}` : '';
    const prompt = buildImagePrompt(
      `Fantasy encounter battleground: ${area.label}${tagDesc}${descDetail}. Wide establishing shot, no characters, dramatic atmospheric lighting.`,
      IMAGE_PROMPT_STYLE.preview,
    );
    const promptHash = crypto.createHash('md5').update(prompt).digest('hex');
    const safeLabel = area.label.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const outputOptions = IMAGE_OUTPUT_PRESETS.encounterArea;
    const fileBaseName = `encounter_area_${sessionId}_${safeLabel}_${promptHash}`;
    const fileName = this.imageFileName(fileBaseName, outputOptions);
    const storage = overrideStorageProvider ?? getImageStorageProvider();
    const config = getConfig();

    const existingKey = await this.findExistingImage(fileBaseName, fileName, storage);
    if (existingKey) {
      return { url: storage.getPublicUrl(existingKey), storageKey: existingKey, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    }

    try {
      console.log(`[ImageService] Generating area image for ${area.label}`);
      const imageProvider = overrideImageProvider ?? createImageProvider();
      const result = await imageProvider.generateImage({ prompt, ...outputOptions });
      const buffer = await this.fetchImageBuffer(result.url);
      const outputDetails = this.providerOutputDetails(result, outputOptions);
      const stored = await storage.putImage({ key: this.imageFileNameWithExtension(fileBaseName, outputDetails.extension), contentType: outputDetails.contentType, body: buffer, cacheControl: 'public, max-age=31536000, immutable' });
      return { url: stored.publicUrl, storageKey: stored.key, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    } catch (error) {
      console.error(`[ImageService] Area image generation failed for ${area.label}:`, error);
      return { url: '', storageKey: '', storageProvider: 'local' };
    }
  }

  public static async generateEnemyAvatar(
    enemy: { name: string; role: string; traits?: string[] },
    sessionId: string,
    overrideImageProvider?: ImageProvider,
    overrideStorageProvider?: ImageStorageProvider,
  ): Promise<{ url: string; storageKey: string; storageProvider: string }> {
    const traitDesc = enemy.traits?.length ? ` with traits: ${enemy.traits.slice(0, 3).join(', ')}` : '';
    const prompt = buildImagePrompt(
      `Extreme close-up avatar of a ${enemy.role} fantasy creature: ${enemy.name}${traitDesc}. Dark atmospheric background, dramatic rim lighting. Only the creature's head and upper body visible. Menacing and intimidating.`,
      IMAGE_PROMPT_STYLE.avatar,
    );
    const promptHash = crypto.createHash('md5').update(prompt).digest('hex');
    const safeName = enemy.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const outputOptions = IMAGE_OUTPUT_PRESETS.avatar;
    const fileBaseName = `enemy_avatar_${sessionId}_${safeName}_${promptHash}`;
    const fileName = this.imageFileName(fileBaseName, outputOptions);
    const storage = overrideStorageProvider ?? getImageStorageProvider();
    const config = getConfig();

    const existingKey = await this.findExistingImage(fileBaseName, fileName, storage);
    if (existingKey) {
      return { url: storage.getPublicUrl(existingKey), storageKey: existingKey, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    }

    try {
      console.log(`[ImageService] Generating enemy avatar for ${enemy.name}`);
      const imageProvider = overrideImageProvider ?? createImageProvider();
      const result = await imageProvider.generateImage({ prompt, ...outputOptions });
      const buffer = await this.fetchImageBuffer(result.url);
      const outputDetails = this.providerOutputDetails(result, outputOptions);
      const stored = await storage.putImage({ key: this.imageFileNameWithExtension(fileBaseName, outputDetails.extension), contentType: outputDetails.contentType, body: buffer, cacheControl: 'public, max-age=31536000, immutable' });
      return { url: stored.publicUrl, storageKey: stored.key, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    } catch (error) {
      console.error(`[ImageService] Enemy avatar generation failed for ${enemy.name}:`, error);
      return { url: '', storageKey: '', storageProvider: 'local' };
    }
  }

  public static async generateImage(
    prompt: string,
    sessionId: string,
    turn: number,
    overrideImageProvider?: ImageProvider,
    overrideStorageProvider?: ImageStorageProvider,
    context?: SceneImageContext,
  ): Promise<ImageResult | null> {
    const finalPrompt = this.buildSceneImagePrompt(prompt, context);
    const promptHash = crypto.createHash('md5').update(finalPrompt).digest('hex');
    const outputOptions = IMAGE_OUTPUT_PRESETS.scene;
    const fileBaseName = `${sessionId}_turn${turn}_${promptHash}`;
    const fileName = this.imageFileName(fileBaseName, outputOptions);
    const storage = overrideStorageProvider ?? getImageStorageProvider();
    const config = getConfig();

    const existingKey = await this.findExistingImage(fileBaseName, fileName, storage);
    if (existingKey) {
      return { url: storage.getPublicUrl(existingKey), storageKey: existingKey, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    }

    try {
      console.log(`[ImageService] Generating image for session ${sessionId}: ${prompt}`);
      const imageProvider = overrideImageProvider ?? createImageProvider();
      const result = await imageProvider.generateImage({ prompt: finalPrompt, ...outputOptions });

      const buffer = await this.fetchImageBuffer(result.url);
      const outputDetails = this.providerOutputDetails(result, outputOptions);
      const stored = await storage.putImage({ key: this.imageFileNameWithExtension(fileBaseName, outputDetails.extension), contentType: outputDetails.contentType, body: buffer, cacheControl: 'public, max-age=31536000, immutable' });
      return { url: stored.publicUrl, storageKey: stored.key, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'content_policy_violation') {
        console.warn('[ImageService] Content policy hit, retrying with sanitized prompt');
        return this.generateSanitizedImage(prompt, sessionId, turn, overrideImageProvider, overrideStorageProvider, context);
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
    overrideImageProvider?: ImageProvider,
    overrideStorageProvider?: ImageStorageProvider,
    context?: SceneImageContext,
  ): Promise<ImageResult | null> {
    const sanitized = this.sanitizePrompt(originalPrompt);
    const finalPrompt = this.buildSceneImagePrompt(`Family-friendly adventure moment: ${sanitized}`, context);
    const promptHash = crypto.createHash('md5').update(finalPrompt).digest('hex');
    const outputOptions = IMAGE_OUTPUT_PRESETS.scene;
    const fileBaseName = `${sessionId}_turn${turn}_${promptHash}_safe`;
    const fileName = this.imageFileName(fileBaseName, outputOptions);
    const storage = overrideStorageProvider ?? getImageStorageProvider();
    const config = getConfig();

    const existingKey = await this.findExistingImage(fileBaseName, fileName, storage);
    if (existingKey) {
      return { url: storage.getPublicUrl(existingKey), storageKey: existingKey, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    }

    try {
      const imageProvider = overrideImageProvider ?? createImageProvider();
      const result = await imageProvider.generateImage({ prompt: finalPrompt, ...outputOptions });
      const buffer = await this.fetchImageBuffer(result.url);
      const outputDetails = this.providerOutputDetails(result, outputOptions);
      const stored = await storage.putImage({ key: this.imageFileNameWithExtension(fileBaseName, outputDetails.extension), contentType: outputDetails.contentType, body: buffer, cacheControl: 'public, max-age=31536000, immutable' });
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
      `Wide camera view inside a living fantasy realm.${worldPart} Several adventurers stand together in the same location as a single group: ${heroList}.${villainHint}${moodPart} Fill the frame with detailed scenery, architecture, terrain, sky, and characters integrated naturally into one continuous environment. The center of the image contains only in-world scenery and adventurers, never a title area, caption area, poster layout, or empty text space.`,
      `${IMAGE_PROMPT_STYLE.preview} Single unified group scene, not separate portraits or a title-screen layout.`,
    );

    const promptHash = crypto.createHash('md5').update(prompt).digest('hex');
    const outputOptions = IMAGE_OUTPUT_PRESETS.preview;
    const fileBaseName = `preview_${session.id}_${promptHash}`;
    const fileName = this.imageFileName(fileBaseName, outputOptions);
    const storage = overrideStorageProvider ?? getImageStorageProvider();
    const config = getConfig();

    const existingKey = await this.findExistingImage(fileBaseName, fileName, storage);
    if (existingKey) {
      return { url: storage.getPublicUrl(existingKey), storageKey: existingKey, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    }

    try {
      console.log(`[ImageService] Generating session preview for ${session.displayName}`);
      const imageProvider = overrideImageProvider ?? createImageProvider();
      const result = await imageProvider.generateImage({ prompt, ...outputOptions });
      const buffer = await this.fetchImageBuffer(result.url);
      const outputDetails = this.providerOutputDetails(result, outputOptions);
      const stored = await storage.putImage({ key: this.imageFileNameWithExtension(fileBaseName, outputDetails.extension), contentType: outputDetails.contentType, body: buffer, cacheControl: 'public, max-age=31536000, immutable' });
      return { url: stored.publicUrl, storageKey: stored.key, storageProvider: config.IMAGE_STORAGE_PROVIDER };
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'content_policy_violation') {
        const sanitizedPrompt = this.sanitizePrompt(prompt);
        return this.generateImage(sanitizedPrompt, session.id, 0, overrideImageProvider, overrideStorageProvider);
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
