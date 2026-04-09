import type { ImageGenerationInput, ImageGenerationOutput, ImageProvider } from './ImageProvider.js';
import { DEFAULT_NEGATIVE_PROMPT } from './ImageProvider.js';

export class LocalAIImageProvider implements ImageProvider {
  private baseUrl: string;
  private model: string;

  constructor() {
    this.baseUrl = process.env.LOCALAI_IMAGE_BASE_URL ?? process.env.LOCALAI_BASE_URL ?? 'http://127.0.0.1:8080';
    this.model = process.env.LOCALAI_IMAGE_MODEL ?? 'stable-diffusion-v1-5';
  }

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    const negativePrompt = input.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT;

    const body = {
      model: this.model,
      prompt: input.prompt,
      negative_prompt: negativePrompt,
      n: 1,
      size: '512x512',
      step: parseInt(process.env.LOCALAI_IMAGE_STEPS ?? '12'),
      response_format: 'b64_json',
    };

    console.log(`[LocalAIImage] Sending request to ${this.baseUrl} model=${this.model}`);
    const start = Date.now();
    const response = await fetch(`${this.baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    console.log(`[LocalAIImage] Response received in ${Date.now() - start}ms`);
    if (!response.ok) {
      throw new Error(`LocalAI image generation failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json() as { data: Array<{ url?: string; b64_json?: string }> };
    const item = data.data?.[0];
    console.log(`[LocalAIImage] Response keys: url=${!!item?.url} b64_json=${!!item?.b64_json} b64_len=${item?.b64_json?.length ?? 0}`);

    if (item?.url) {
      console.log(`[LocalAIImage] Returning URL: ${item.url}`);
      return { url: item.url };
    }

    if (item?.b64_json) {
      return { url: `data:image/png;base64,${item.b64_json}` };
    }

    throw new Error('LocalAI image generation returned no image data');
  }
}
