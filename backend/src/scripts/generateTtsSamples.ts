/**
 * Script to compare OpenAI TTS voices for game narration.
 *
 * Run from backend/:
 *   cd backend && npx tsx --env-file=../.env src/scripts/generateTtsSamples.ts
 *
 * Output: tts-samples/ directory. Skips files that already exist.
 *
 * Models used:
 *   gpt-4o-mini-tts - all voices (supports instructions, newer voices)
 *   tts-1 / tts-1-hd - legacy voices only (alloy, echo, fable, nova, onyx, shimmer)
 */

import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

const SAMPLE_TURNS: Array<{ label: string; narration: string }> = [
  {
    label: 'low-tension',
    narration:
      'The party emerges from the forest into a sun-drenched meadow. Wildflowers sway gently in the breeze, ' +
      'and a distant stream murmurs over smooth stones. Aria spots a cluster of glowing mushrooms near an ancient oak, ' +
      'their soft light pulsing like sleeping embers.',
  },
  {
    label: 'medium-tension',
    narration:
      'The corridor grows narrower, torchlight flickering against damp stone walls. Something skitters in the ' +
      'darkness ahead - too large to be a rat. Finn raises his hand and the party halts. A low, rhythmic breathing ' +
      'echoes from behind the sealed iron door, and a thin line of orange light glows beneath it.',
  },
  {
    label: 'high-tension',
    narration:
      'The dragon rises from the crater, wings blotting out the moon. Its roar splits the night and sends loose ' +
      'rubble cascading into the abyss below. Zara rolls behind a crumbling column as a torrent of fire chars the ' +
      'ground where she stood a heartbeat ago. The heat is immense - the stone itself begins to glow.',
  },
];

// All current OpenAI TTS voices.
// models: which model(s) to test. Newer voices only work with gpt-4o-mini-tts.
const VOICE_CONFIGS: Array<{
  voice: OpenAI.Audio.Speech.SpeechCreateParams['voice'];
  speed?: number;
  models: string[];
}> = [
  { voice: 'cedar',   models: ['gpt-4o-mini-tts'] },
  { voice: 'marin',   models: ['gpt-4o-mini-tts'] },
  { voice: 'fable',   models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] },
  { voice: 'onyx',    models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'], speed: 0.92 },
  { voice: 'nova',    models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] },
  { voice: 'sage',    models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'], speed: 0.94 },
  { voice: 'shimmer', models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] }, // shimmer is tts-1 compatible
  { voice: 'alloy',   models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] },
  { voice: 'echo',    models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] },
  { voice: 'ash',     models: ['gpt-4o-mini-tts'] },
  { voice: 'ballad',  models: ['gpt-4o-mini-tts'] },
  { voice: 'coral',   models: ['gpt-4o-mini-tts'] },
  { voice: 'verse',   models: ['gpt-4o-mini-tts'] },
];

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set in environment.');
    process.exit(1);
  }

  const client = new OpenAI({ apiKey });
  const outDir = path.join(process.cwd(), 'tts-samples');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let generated = 0;
  let skipped = 0;

  for (const voiceCfg of VOICE_CONFIGS) {
    for (const turn of SAMPLE_TURNS) {
      for (const model of voiceCfg.models) {
        const filename = `${turn.label}__${voiceCfg.voice}-${model}.mp3`;
        const outPath = path.join(outDir, filename);
        if (fs.existsSync(outPath)) {
          console.log(`Skipping: ${filename}`);
          skipped++;
          continue;
        }
        console.log(`Generating: ${filename} ...`);
        const response = await client.audio.speech.create({
          model: model,
          voice: voiceCfg.voice,
          input: turn.narration,
          response_format: 'mp3',
          speed: voiceCfg.speed ?? 1,
        });
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(outPath, buffer);
        console.log(`  -> saved ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
        generated++;
      }
    }
  }

  console.log(`\nDone. Generated ${generated}, skipped ${skipped}. Output: ${outDir}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
