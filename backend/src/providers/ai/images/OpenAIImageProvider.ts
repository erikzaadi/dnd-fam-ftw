import OpenAI from 'openai';
import type { ImageGenerationInput, ImageGenerationOutput, ImageProvider } from './ImageProvider.js';

let _openai: OpenAI | null = null;
const openai = () => (_openai ??= new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_BASE_URL && { baseURL: process.env.OPENAI_BASE_URL }),
}));

export class OpenAIImageProvider implements ImageProvider {
  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    // DALL-E ignores negativePrompt. All anti-UI constraints must live in the positive prompt.
    // Leading with "pure standalone artwork" is the most reliable signal against screenshot/editor output.
    const prompt = `Pure standalone fantasy artwork. This is a finished painting - not a screenshot, not a photo being edited, not a software mockup. No application window, no toolbar, no side panel, no menu bar, no canvas UI, no editor chrome, no interface of any kind. No typography, lettering, captions, watermark, page layout, or writing. ${input.prompt}`;

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
