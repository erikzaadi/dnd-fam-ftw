/**
 * One-time script to generate static avatar images for special game events.
 * Run from backend/: npx tsx src/scripts/generateStaticAssets.ts
 *
 * Generates:
 *   public/images/intervention_dragon.png  - dramatic dragon rescue
 *   public/images/sanctuary_light.png      - divine sanctuary light
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OUT_DIR = path.join(__dirname, '..', '..', 'public', 'images');

const ASSETS: Array<{ filename: string; prompt: string; size?: '1024x1024' | '1792x1024' | '1024x1792' }> = [
  {
    filename: 'intervention_dragon.png',
    prompt: 'NO TEXT. NO WORDS. NO LETTERS. Fantasy style: a massive ancient dragon with glowing amber eyes swooping down from stormy skies, wings spread wide, saving tiny adventurers below, dramatic rescue scene, golden light breaking through dark clouds, fantasy illustration, cinematic lighting, vibrant colors, storybook art',
  },
  {
    filename: 'sanctuary_light.png',
    prompt: 'NO TEXT. NO WORDS. NO LETTERS. Fantasy style: a serene sanctuary bathed in soft divine golden light streaming through a stone archway, peaceful mossy clearing with magical glowing runes, adventurers resting safely, ethereal glow, healing light, fantasy illustration, cinematic lighting, soft blue and gold tones, storybook art',
  },
  {
    filename: 'dm_thinking.png',
    prompt: 'NO TEXT. NO WORDS. NO LETTERS. Fantasy style: a mysterious hooded dungeon master figure hunched over a massive arcane tome, surrounded by floating magical runes and glowing dice, candlelight flickering in a shadowy tavern, dramatic moody lighting, mystical atmosphere, fantasy illustration, dark and atmospheric storybook art',
  },
  {
    filename: 'home_banner.png',
    size: '1792x1024',
    prompt: 'NO TEXT. NO WORDS. NO LETTERS. Wide cinematic fantasy banner: a colossal ancient dragon with glowing amber eyes soaring above a vast magical landscape at dusk, party of tiny adventurers silhouetted far below on a mountain ridge looking up in awe, sweeping panoramic vista, dramatic orange and gold sky, volumetric light rays, epic scale, fantasy illustration, storybook art, deep atmospheric perspective',
  },
];

async function generate(asset: { filename: string; prompt: string; size?: '1024x1024' | '1792x1024' | '1024x1792' }) {
  const outPath = path.join(OUT_DIR, asset.filename);
  if (fs.existsSync(outPath)) {
    console.log(`[skip] ${asset.filename} already exists`);
    return;
  }

  console.log(`[gen]  ${asset.filename} ...`);
  const response = await openai.images.generate({
    model: process.env.OPENAI_IMAGE_MODEL ?? 'dall-e-3',
    prompt: asset.prompt,
    n: 1,
    size: asset.size ?? '1024x1024',
    response_format: 'b64_json',
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error(`No b64_json returned for ${asset.filename}`);
  }

  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  console.log(`[done] ${asset.filename}`);
}

for (const asset of ASSETS) {
  await generate(asset);
}

console.log('All static assets generated.');
