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
  'text, words, letters, watermark, signature, caption, label, title, logo, UI, interface, speech bubble, comic book text, writing, inscriptions, typography, font, banner, poster, subtitle, headline, calligraphy, readable text, written text';
