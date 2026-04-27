/**
 * Temporary script to compare OpenAI gpt-4o-mini-tts voices/instructions
 * for fantasy game narration.
 *
 * Run from repo root:
 *   cd backend && npx tsx --env-file=../.env src/scripts/generateGpt4oMiniTtsSamples.ts
 *
 * Output: tts-samples-gpt4o-mini/ directory.
 * Delete this script once you've picked a voice/instruction combo.
 */

import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'gpt-4o-mini-tts' as const;

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

const VOICE_CONFIGS: Array<{
  voice: OpenAI.Audio.Speech.SpeechCreateParams['voice'];
  gender: string;
}> = [
  { voice: 'onyx', gender: 'male' },
  { voice: 'echo', gender: 'male' },
  { voice: 'ash', gender: 'male' },
  { voice: 'fable', gender: 'storyteller' },
  { voice: 'sage', gender: 'female' },
  { voice: 'coral', gender: 'female' },
];

const INSTRUCTION_PRESETS: Array<{ label: string; instructions: string }> = [
  {
    label: 'uk-fantasy-narrator',
    instructions:
      'Speak as a refined British fantasy audiobook narrator. Calm, immersive, measured, and elegant. ' +
      'Use clear pronunciation, restrained drama, and natural pauses. Do not sound like an assistant or announcer.',
  },
  {
    label: 'low-warm-storybook',
    instructions:
      'Speak with a warm British storyteller tone, gentle and wondrous, like narrating a fantasy novel by candlelight. ' +
      'Slow, soft pacing. Let descriptive details breathe.',
  },
  {
    label: 'medium-hushed-suspense',
    instructions:
      'Speak with a controlled British narrator tone, quiet and suspenseful. Slightly hushed, tense, and deliberate. ' +
      'Build unease without becoming theatrical.',
  },
  {
    label: 'high-epic-restrained',
    instructions:
      'Speak with serious British epic-fantasy narration. Intense but restrained. Add urgency without shouting. ' +
      'Keep the words clear and cinematic.',
  },
];

function safeName(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set in environment.');
    process.exit(1);
  }

  const client = new OpenAI({ apiKey });
  const outDir = path.join(process.cwd(), 'tts-samples-gpt4o-mini');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let generated = 0;

  for (const voiceCfg of VOICE_CONFIGS) {
    for (const turn of SAMPLE_TURNS) {
      for (const preset of INSTRUCTION_PRESETS) {
        const filename = `${turn.label}__${voiceCfg.voice}__${safeName(preset.label)}__${MODEL}.mp3`;
        const outPath = path.join(outDir, filename);

        if (fs.existsSync(outPath)) {
          console.log(`Skipping: ${filename} since it exists...`);
          continue;
        }

        console.log(`Generating: ${filename} ...`);

        const response = await client.audio.speech.create({
          model: MODEL,
          voice: voiceCfg.voice,
          input: turn.narration,
          instructions: preset.instructions,
          response_format: 'mp3',
        });

        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(outPath, buffer);

        generated += 1;
        console.log(`  -> saved ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
      }
    }
  }

  console.log(`\nDone. Generated ${generated} files in ${outDir}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
