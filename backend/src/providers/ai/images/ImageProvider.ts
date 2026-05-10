export type ImageGenerationInput = {
  prompt: string;
};

export type ImageGenerationOutput = {
  url: string;
};

export interface ImageProvider {
  generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput>;
}
