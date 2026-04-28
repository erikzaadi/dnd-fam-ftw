export type ImageGenerationInput = {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
};

export type ImageGenerationOutput = {
  url: string;
};

export interface ImageProvider {
  generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput>;
}

export const DEFAULT_NEGATIVE_PROMPT =
  'text, words, letters, numbers, watermark, signature, caption, label, title, logo, UI, interface, speech bubble, comic book text, writing, inscriptions, typography, font, banner, poster, subtitle, headline, calligraphy, readable text, written text, runes, glyphs, symbols, plaques, signs, signboards, map labels, scroll text, book pages, carved writing, editing controls, image editor, photoshop UI, design software, crop marks, crop handles, transform handles, control points, selection box, bounding box, rulers, grid lines, guide lines, wireframe, color picker, color wheel, tool palette, sliders, panels, overlay, split screen, split frame, divided frame, diptych, triptych, collage, multiple panels, side-by-side, before and after, duplicate subject, two portraits, repeated face';
