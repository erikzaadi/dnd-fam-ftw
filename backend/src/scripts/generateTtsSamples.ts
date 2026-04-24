/**
 * Temporary script to compare OpenAI TTS voices for game narration.
 *
 * Run from repo root:
 *   cd backend && npx tsx --env-file=../.env src/scripts/generateTtsSamples.ts
 *
 * Output: tts-samples/ directory with 6 MP3 files (3 turns x 2 voices).
 * Delete this script once you've picked a voice.
 */

import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

// Three sample narrations at different tension levels.
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

// Two voice configurations to compare.
const VOICE_CONFIGS: Array<{ voice: OpenAI.Audio.Speech.SpeechCreateParams['voice']; model: string; label: string }> = [
  { voice: 'nova', model: 'tts-1', label: 'nova-standard' },
  { voice: 'shimmer', model: 'tts-1-hd', label: 'shimmer-hd' },
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

  for (const voiceCfg of VOICE_CONFIGS) {
    for (const turn of SAMPLE_TURNS) {
      const filename = `${turn.label}__${voiceCfg.label}.mp3`;
      const outPath = path.join(outDir, filename);
      console.log(`Generating: ${filename} ...`);
      const response = await client.audio.speech.create({
        model: voiceCfg.model,
        voice: voiceCfg.voice,
        input: turn.narration,
        response_format: 'mp3',
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(outPath, buffer);
      console.log(`  -> saved ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
    }
  }

  console.log(`\nDone. ${SAMPLE_TURNS.length * VOICE_CONFIGS.length} files in ${outDir}`);
  console.log('Voices compared:');
  for (const v of VOICE_CONFIGS) {
    console.log(`  ${v.label}: voice=${v.voice}, model=${v.model}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
