import type { ImageGenerationInput, ImageGenerationOutput, ImageProvider } from './ImageProvider.js';
import { createOpenAIClient, getOpenAIImageModel } from '../openAiClient.js';

export class OpenAIImageProvider implements ImageProvider {
  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    const prompt = input.prompt;

    const model = getOpenAIImageModel();
    const isDallE3 = model === 'dall-e-3';
    const response = await createOpenAIClient().images.generate({
      model,
      prompt,
      n: 1,
      size: '1024x1024',
      // dall-e-3: force b64 (defaults to url) and use its quality vocabulary.
      // gpt-image-* models: don't accept response_format; use 'low' quality for
      // speed and cost - sufficient for DnD scene illustration.
      ...(isDallE3
        ? { response_format: 'b64_json', quality: 'standard' }
        : { quality: 'low' }),
    }, { signal: AbortSignal.timeout(120_000) });

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
