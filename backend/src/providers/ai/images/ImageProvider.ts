export type ImageGenerationInput = {
  prompt: string;
  size?: string;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  outputCompression?: number;
};

export type ImageGenerationOutput = {
  url: string;
  contentType: string;
  extension: string;
};

export interface ImageProvider {
  generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput>;
}
