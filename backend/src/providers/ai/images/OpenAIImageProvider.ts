import type { ImageGenerationInput, ImageGenerationOutput, ImageProvider } from './ImageProvider.js';
import { createOpenAIClient, getOpenAIImageModel } from '../openAiClient.js';

const FORMAT_DETAILS = {
  png: { contentType: 'image/png', extension: 'png' },
  jpeg: { contentType: 'image/jpeg', extension: 'jpg' },
  webp: { contentType: 'image/webp', extension: 'webp' },
} as const;

export class OpenAIImageProvider implements ImageProvider {
  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    const prompt = input.prompt;

    const model = getOpenAIImageModel();
    const outputFormat = input.outputFormat ?? 'jpeg';
    const formatDetails = FORMAT_DETAILS[outputFormat];
    const response = await createOpenAIClient().images.generate({
      model,
      prompt,
      n: 1,
      size: (input.size ?? '1024x1024') as '1024x1024',
      quality: 'low',
      output_format: outputFormat,
      ...(outputFormat !== 'png' && typeof input.outputCompression === 'number'
        ? { output_compression: input.outputCompression }
        : {}),
    }, { signal: AbortSignal.timeout(120_000) });

    const item = response.data?.[0];
    if (item?.b64_json) {
      return { url: `data:${formatDetails.contentType};base64,${item.b64_json}`, ...formatDetails };
    }
    if (item?.url) {
      return { url: item.url, ...formatDetails };
    }
    throw new Error('OpenAI image generation returned neither b64_json nor url');
  }
}
