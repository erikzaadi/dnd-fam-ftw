import type { ImageGenerationInput, ImageGenerationOutput, ImageProvider } from './ImageProvider.js';
import { createOpenAIClient, getOpenAIImageModel } from '../openAiClient.js';

export class OpenAIImageProvider implements ImageProvider {
  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    const prompt = input.prompt;

    const response = await createOpenAIClient().images.generate({
      model: getOpenAIImageModel(),
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
