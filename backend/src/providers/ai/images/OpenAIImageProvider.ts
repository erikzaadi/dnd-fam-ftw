import OpenAI from 'openai';
import type { ImageGenerationInput, ImageGenerationOutput, ImageProvider } from './ImageProvider.js';

let _openai: OpenAI | null = null;
const openai = () => (_openai ??= new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_BASE_URL && { baseURL: process.env.OPENAI_BASE_URL }),
}));

export class OpenAIImageProvider implements ImageProvider {
  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    // DALL-E does not support negative prompts — we bake the no-text requirement into the positive prompt
    const prompt = `NO TEXT. NO WORDS. NO LETTERS. NO WRITING OF ANY KIND. Fantasy style, vibrant colors, purely graphical illustration: ${input.prompt}`;

    const response = await openai().images.generate({
      model: process.env.OPENAI_IMAGE_MODEL ?? 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    });

    const item = response.data?.[0];
    if (item?.b64_json) {
      return { url: `data:image/png;base64,${item.b64_json}` };
    }
    if (item?.url) {
      return { url: item.url };
    }
    throw new Error('OpenAI image generation returned neither b64_json nor url');
  }
}
