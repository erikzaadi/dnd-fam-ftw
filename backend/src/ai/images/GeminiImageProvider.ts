import axios from 'axios';
import type { ImageGenerationInput, ImageGenerationOutput, ImageProvider } from './ImageProvider.js';

export class GeminiImageProvider implements ImageProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
    this.model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.0-flash-exp';
  }

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    const prompt = `NO TEXT, NO WRITING, NO LETTERS. Fantasy illustration: ${input.prompt}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await axios.post(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['image'] },
    });

    const part = response.data?.candidates?.[0]?.content?.parts
      ?.find((p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData);

    if (!part?.inlineData?.data) {
      throw new Error('Gemini image generation returned no image data');
    }

    const { mimeType, data } = part.inlineData;
    return { url: `data:${mimeType};base64,${data}` };
  }
}
