/**
 * One-time script to generate static avatar images for special game events.
 * Run from backend/: npx tsx --env-file=../.env src/scripts/generateStaticAssets.ts
 *
 * Generates into frontend/public/images/:
 *   intervention_dragon.png         - dramatic dragon rescue
 *   sanctuary_light.png             - divine sanctuary light
 *   dm_thinking.png                 - DM thinking placeholder
 *   home_banner.png                 - home page banner
 *   onboarding/preview.png          - onboarding session preview (wide)
 *   onboarding/scene_inn.png        - onboarding turn 0: the Breadcrumbs Inn
 *   onboarding/scene_brom.png       - onboarding turn 1: Brom shakes the tree
 *   onboarding/scene_finn.png       - onboarding turn 2: Finn scouts the camp
 *   onboarding/scene_zara.png       - onboarding turn 3: Zara's Dazzle Burst
 *   onboarding/scene_mira.png       - onboarding turn 4: Mira and the crying goblin
 *   onboarding/avatar_brom.png      - Brom Ironbread portrait
 *   onboarding/avatar_finn.png      - Finn Quickcrust portrait
 *   onboarding/avatar_zara.png      - Zara Spellsworth portrait
 *   onboarding/avatar_mira.png      - Mira Warmheal portrait
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

const STATIC_ASSET_GUARDRAIL = 'Finished standalone fantasy artwork. Single edge-to-edge image. Blank unmarked surfaces only. No lettering, numbers, logos, captions, borders, frames, panels, menus, toolbars, editor controls, crop handles, rulers, guides, or software interface elements.';

const ASSETS: Array<{ filename: string; prompt: string; size?: '1024x1024' | '1792x1024' | '1024x1792' }> = [
  {
    filename: 'intervention_dragon.png',
    prompt: 'Fantasy style: a massive ancient dragon with glowing amber eyes swooping down from stormy skies, wings spread wide, saving tiny adventurers below, dramatic rescue scene, golden light breaking through dark clouds, fantasy illustration, cinematic lighting, vibrant colors, storybook art',
  },
  {
    filename: 'sanctuary_light.png',
    prompt: 'Fantasy style: a serene sanctuary bathed in soft divine golden light streaming through a stone archway, peaceful mossy clearing with abstract magical glow, adventurers resting safely, ethereal healing light, fantasy illustration, cinematic lighting, soft blue and gold tones, storybook art',
  },
  {
    filename: 'dm_thinking.png',
    prompt: 'Fantasy style: a mysterious hooded dungeon master figure at a candlelit table with a closed unmarked arcane tome and glowing blank dice, candlelight flickering in a shadowy tavern, dramatic moody lighting, mystical atmosphere, fantasy illustration, dark and atmospheric storybook art',
  },
  {
    filename: 'home_banner.png',
    size: '1792x1024',
    prompt: 'Wide cinematic fantasy banner: a colossal ancient dragon with glowing amber eyes soaring above a vast magical landscape at dusk, party of tiny adventurers silhouetted far below on a mountain ridge looking up in awe, sweeping panoramic vista, dramatic orange and gold sky, volumetric light rays, epic scale, fantasy illustration, storybook art, deep atmospheric perspective',
  },
  {
    filename: 'campaign_over.png',
    size: '1024x1024',
    prompt: 'Cinematic dark fantasy scene, mysterious empty landscape at twilight, a single ancient sword standing in the ground at the center, worn and aged, surrounded by faint glowing embers and scattered relics, a dim magical artifact nearby with a soft fading glow, extinguished torches with gentle smoke trails, soft fog drifting through the scene, darkness gradually closing in from the edges, cold desaturated colors, distant silhouettes of ruins barely visible, subtle sense of stillness and finality, no characters present, environment feels silent and untouched, strong depth of field, centered composition, moody and cinematic, highly detailed',
  },
  {
    filename: 'icon_dice.png',
    size: '1024x1024',
    prompt: 'Fantasy RPG icon: a glowing blank twenty-sided die with deep navy blue facets and shimmering gold edges, centered on a dark background, magical golden light radiating from within, painterly fantasy style, high detail, dramatic lighting, icon composition',
  },
  {
    filename: 'icon_inventory.png',
    size: '1024x1024',
    prompt: 'Fantasy RPG icon: a worn leather adventurer backpack stuffed with unmarked parchment rolls, a canteen, and a bedroll, centered on a dark background, warm amber candlelight glow, painterly fantasy style, high detail, icon composition',
  },
  {
    filename: 'icon_magic.png',
    size: '1024x1024',
    prompt: 'Fantasy RPG icon: an ornate wooden magic wand with a glowing crystal tip crackling with sparks of purple and blue arcane energy, centered on a dark background, magical light emanating outward, painterly fantasy style, high detail, icon composition',
  },
  {
    filename: 'icon_might.png',
    size: '1024x1024',
    prompt: 'Fantasy RPG icon: a gleaming broad sword with a golden cross-guard embedded upright in stone, radiant white and gold light shining along the blade, centered on a dark background, painterly fantasy style, high detail, heroic and powerful, icon composition',
  },
  {
    filename: 'icon_mischief.png',
    size: '1024x1024',
    prompt: 'Fantasy RPG icon: a slender rogue dagger with a curved blade balanced against a smiling theatrical drama mask, a blank playing card and coin glinting nearby, centered on a dark background, green and gold tones, painterly fantasy style, high detail, icon composition',
  },
  {
    filename: 'icon_potion.png',
    size: '1024x1024',
    prompt: 'Fantasy RPG icon: a round glass potion bottle filled with glowing crimson liquid, bubbles rising inside, cork stopper, magical red and pink light radiating outward, centered on a dark background, painterly fantasy style, high detail, icon composition',
  },
  {
    filename: 'icon_scroll.png',
    size: '1024x1024',
    prompt: 'Fantasy RPG icon: an ancient blank parchment partially unrolled, aged yellow-brown with worn wooden handles, soft golden magical glow above the empty surface, centered on a dark background, warm candlelight, painterly fantasy style, high detail, icon composition',
  },
  // ── Onboarding session: A Crumby Situation ────────────────────────────────
  {
    filename: 'onboarding/preview.png',
    size: '1792x1024',
    prompt: 'Wide cinematic fantasy scene: a warm forest clearing at golden hour, a colourful bakery cart loaded with fresh bread and pastries stands recovered in the center, four cheerful adventurers celebrating nearby - a stocky human fighter, a tiny halfling rogue, a graceful elf mage, and a warm human cleric - a cosy lantern-lit inn visible through the trees behind them, whimsical lighthearted fantasy style, storybook illustration, warm amber and green tones',
  },
  {
    filename: 'onboarding/scene_inn.png',
    size: '1024x1024',
    prompt: 'Fantasy illustration: a cosy warm forest inn at dusk, a worried baker woman in flour-dusted apron wringing her hands outside the front door, a trail of white flour disappearing into a dark mysterious forest path, amber light glowing from the inn windows, a hand-painted inn sign above the door, whimsical lighthearted storybook art style',
  },
  {
    filename: 'onboarding/scene_brom.png',
    size: '1024x1024',
    prompt: 'Fantasy illustration: a stocky cheerful human fighter with a big grin bear-hugging a large oak tree trunk, leaves and acorns tumbling down around him, a tiny green forest trickster safely peeking from behind a nearby bush with a surprised expression, forest clearing with golden sunlight, playful slapstick comedy moment, whimsical lighthearted storybook art style',
  },
  {
    filename: 'onboarding/scene_finn.png',
    size: '1024x1024',
    prompt: 'Fantasy illustration: a tiny nimble halfling rogue in dark leather armour crouched silently in dense forest undergrowth, peering toward a ring of tiny green forest trickster tents in a lit clearing ahead, a satisfied expression on his face with two golden croissants tucked under his arm, warm campfire glow in the distance, whimsical lighthearted storybook art style',
  },
  {
    filename: 'onboarding/scene_zara.png',
    size: '1024x1024',
    prompt: 'Fantasy illustration: a tall elegant female elf mage casting a brilliant burst of dazzling sparkling multicoloured light above a forest trickster camp, tiny green tricksters stumbling around harmlessly with bewildered dazzled expressions, a bakery cart visible in the center of the camp, the female mage standing tall and satisfied, magical sparkling light effects, whimsical lighthearted storybook art style',
  },
  {
    filename: 'onboarding/scene_mira.png',
    size: '1024x1024',
    prompt: 'Fantasy illustration: a warm kind human female cleric in white and gold robes kneeling gently to eye level with a tiny green forest trickster wearing a croissant as a hat, the trickster shyly offering a glass jar with a sheepish expression, soft warm light in a forest clearing, a gentle and funny moment, whimsical lighthearted storybook art style',
  },
  {
    filename: 'onboarding/avatar_brom.png',
    size: '1024x1024',
    prompt: 'Fantasy RPG character portrait: a stocky cheerful muscular human fighter, broad shoulders, short beard, kind enthusiastic eyes, practical battered plate armour, casually resting a battle axe on his shoulder, centered square portrait composition, warm amber tones, painterly fantasy storybook style, simple dark background',
  },
  {
    filename: 'onboarding/avatar_finn.png',
    size: '1024x1024',
    prompt: 'Fantasy RPG character portrait: a small nimble halfling rogue with large bright eyes and a mischievous grin, curly brown hair, light leather armour with many pockets, crumbs visible on his shirt, looking slightly guilty but charming, centered square portrait composition, warm earthy tones, painterly fantasy storybook style, simple dark background',
  },
  {
    filename: 'onboarding/avatar_zara.png',
    size: '1024x1024',
    prompt: 'Fantasy RPG character portrait: single portrait of one female elf mage, tall and elegant with sharp precise features, silver-white long hair, cool blue and silver mage robes, holding a glowing arcane wand, expression of calm focused intensity, centered bust-up composition against a plain dark background, warm painterly storybook illustration style, single image no panels no collage no multiple views no reference sheet no editor UI no software interface no rulers no toolbars',
  },
  {
    filename: 'onboarding/avatar_mira.png',
    size: '1024x1024',
    prompt: 'Fantasy RPG character portrait: a warm-faced human female cleric with kind eyes and a gentle reassuring smile, brown hair in a practical braid, simple white and gold clerical robes with a holy symbol, holding a small healing potion, centered square portrait composition, warm golden and white tones, painterly fantasy storybook style, simple dark background',
  },
];

async function generate(asset: { filename: string; prompt: string; size?: '1024x1024' | '1792x1024' | '1024x1792' }) {
  const outPath = path.join(OUT_DIR, asset.filename);
  if (fs.existsSync(outPath)) {
    console.log(`[skip] ${asset.filename} already exists`);
    return;
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  console.log(`[gen]  ${asset.filename} ...`);
  const response = await openai.images.generate({
    model: process.env.OPENAI_IMAGE_MODEL ?? 'dall-e-3',
    prompt: `${STATIC_ASSET_GUARDRAIL} ${asset.prompt}`,
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
