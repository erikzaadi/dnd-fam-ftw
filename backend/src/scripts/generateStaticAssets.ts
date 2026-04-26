/**
 * One-time script to generate static avatar images for special game events.
 * Run from backend/: npx tsx src/scripts/generateStaticAssets.ts
 *
 * Generates into frontend/public/images/:
 *   intervention_dragon.png  - dramatic dragon rescue
 *   sanctuary_light.png      - divine sanctuary light
 *   dm_thinking.png          - DM thinking placeholder
 *   home_banner.png          - home page banner
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OUT_DIR = path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'images');

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
  {
    filename: 'campaign_over.png',
    size: '1024x1024',
    prompt: 'NO TEXT. NO WORDS. NO LETTERS. Cinematic dark fantasy scene, mysterious empty landscape at twilight, a single ancient sword standing in the ground at the center, worn and aged, surrounded by faint glowing embers and scattered relics, a dim magical artifact nearby with a soft fading glow, extinguished torches with gentle smoke trails, soft fog drifting through the scene, darkness gradually closing in from the edges, cold desaturated colors, distant silhouettes of ruins barely visible, subtle sense of stillness and finality, no characters present, environment feels silent and untouched, strong depth of field, centered composition, moody and cinematic, highly detailed',
  },
  {
    filename: 'icon_dice.png',
    size: '1024x1024',
    prompt: 'NO TEXT. NO WORDS. NO NUMBERS. NO LETTERS. Fantasy RPG icon: a glowing icosahedral d20 die with deep navy blue facets and shimmering gold edges, centered on a dark background, magical golden light radiating from within, painterly fantasy style, high detail, dramatic lighting, icon composition',
  },
  {
    filename: 'icon_inventory.png',
    size: '1024x1024',
    prompt: 'NO TEXT. NO WORDS. NO LETTERS. Fantasy RPG icon: a worn leather adventurer backpack stuffed with rolled-up maps, a canteen, and a bedroll, centered on a dark background, warm amber candlelight glow, painterly fantasy style, high detail, icon composition',
  },
  {
    filename: 'icon_magic.png',
    size: '1024x1024',
    prompt: 'NO TEXT. NO WORDS. NO LETTERS. Fantasy RPG icon: an ornate wooden magic wand with a glowing crystal tip crackling with sparks of purple and blue arcane energy, centered on a dark background, magical light emanating outward, painterly fantasy style, high detail, icon composition',
  },
  {
    filename: 'icon_might.png',
    size: '1024x1024',
    prompt: 'NO TEXT. NO WORDS. NO LETTERS. Fantasy RPG icon: a gleaming broad sword with a golden cross-guard embedded upright in stone, radiant white and gold light shining along the blade, centered on a dark background, painterly fantasy style, high detail, heroic and powerful, icon composition',
  },
  {
    filename: 'icon_mischief.png',
    size: '1024x1024',
    prompt: 'NO TEXT. NO WORDS. NO LETTERS. Fantasy RPG icon: a slender rogue dagger with a curved blade balanced against a smiling theatrical drama mask, a playing card and coin glinting nearby, centered on a dark background, green and gold tones, painterly fantasy style, high detail, icon composition',
  },
  {
    filename: 'icon_potion.png',
    size: '1024x1024',
    prompt: 'NO TEXT. NO WORDS. NO LETTERS. Fantasy RPG icon: a round glass potion bottle filled with glowing crimson liquid, bubbles rising inside, cork stopper, magical red and pink light radiating outward, centered on a dark background, painterly fantasy style, high detail, icon composition',
  },
  {
    filename: 'icon_scroll.png',
    size: '1024x1024',
    prompt: 'NO TEXT. NO WORDS. NO LETTERS. NO WRITING. Fantasy RPG icon: an ancient parchment scroll partially unrolled, aged yellow-brown with worn wooden handles, glowing faint gold runes hovering above the blank surface, centered on a dark background, warm candlelight, painterly fantasy style, high detail, icon composition',
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
