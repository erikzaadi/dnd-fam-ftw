/**
 * One-off probe for the gpt-image-2 retirement (2027-02-10): runs the app's exact image
 * request shapes against each candidate model so they can be compared side by side.
 *
 * Paid, but bounded: 4 images per model at quality "low" (about $0.25 in total). Use a dev key.
 *
 * Run from backend/:
 *   npx tsx --env-file=../.env src/scripts/probeImageReplacement.ts [model ...]
 *
 * Output: ../temp/image-probe/ ({model}-{shape}.jpg to look at, plus summary.json with
 * failures, latency, token usage and estimated cost per request)
 */

import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { IMAGE_PROMPT_STYLE } from '../services/imageService.js';
import { estimateCostUsd } from '../services/usagePricing.js';

const DEFAULT_MODELS = ['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare', 'gpt-image-2'];

// Same size, format and compression as IMAGE_OUTPUT_PRESETS (imageService.ts) and the wide
// static asset in generateStaticAssets.ts.
const SHAPES = [
  { label: 'avatar', size: '816x816', compression: 75, prompt: `${IMAGE_PROMPT_STYLE.avatar} A cheerful halfling bard with a feathered cap and a lute strap over one shoulder.` },
  { label: 'scene', size: '1024x1024', compression: 80, prompt: `${IMAGE_PROMPT_STYLE.scene} A young elf ranger leaps across a mossy ravine while a grumpy troll shakes its fist from the far bank.` },
  { label: 'preview', size: '1024x1024', compression: 80, prompt: `${IMAGE_PROMPT_STYLE.preview} A floating island village at sunset, rope bridges between glowing lantern towers.` },
  { label: 'static-wide', size: '1792x1024', compression: 80, prompt: 'Wide fantasy banner: a friendly dragon curled around a hilltop castle at dawn, painterly, no text.' },
];

const outDir = path.resolve(process.cwd(), '../temp/image-probe');

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set in environment.');
    process.exit(1);
  }
  if (process.env.OPENAI_BASE_URL) {
    console.warn(`OPENAI_BASE_URL is set (${process.env.OPENAI_BASE_URL}); this probe targets api.openai.com directly.`);
  }
  const models = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_MODELS;
  const client = new OpenAI({ apiKey });
  fs.mkdirSync(outDir, { recursive: true });

  const summary: Record<string, Record<string, unknown>> = {};
  for (const model of models) {
    summary[model] = {};
    for (const shape of SHAPES) {
      const started = Date.now();
      try {
        const response = await client.images.generate({
          model,
          prompt: shape.prompt,
          n: 1,
          size: shape.size as '1024x1024',
          quality: 'low',
          output_format: 'jpeg',
          output_compression: shape.compression,
        }, { signal: AbortSignal.timeout(120_000) });
        const b64 = response.data?.[0]?.b64_json;
        if (!b64) {
          throw new Error('no b64_json in response');
        }
        const file = path.join(outDir, `${model}-${shape.label}.jpg`);
        fs.writeFileSync(file, Buffer.from(b64, 'base64'));
        const usage = response.usage;
        summary[model][shape.label] = {
          ok: true,
          ms: Date.now() - started,
          kb: Math.round(Buffer.byteLength(b64, 'base64') / 1024),
          inputTokens: usage?.input_tokens ?? null,
          outputTokens: usage?.output_tokens ?? null,
          estimatedUsd: estimateCostUsd({ kind: 'image', model, inputTokens: usage?.input_tokens ?? null, outputTokens: usage?.output_tokens ?? null, ttsCharacters: null, imageCount: 1 }),
          file,
        };
      } catch (err) {
        summary[model][shape.label] = { ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
      }
      console.log(model, shape.label, JSON.stringify(summary[model][shape.label]));
    }
  }

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ date: new Date().toISOString(), summary }, null, 2));
  console.log(`\nWrote ${path.join(outDir, 'summary.json')}. Compare the images in ${outDir}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
