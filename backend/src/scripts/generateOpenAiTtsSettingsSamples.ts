/**
 * Generate the two static OpenAI narrator samples used by the Settings page.
 *
 * Run from repo root:
 *   cd backend && npx tsx --env-file=../.env src/scripts/generateOpenAiTtsSettingsSamples.ts
 *
 * Output:
 *   ../frontend/public/sound/tts/openai-narrator-male.mp3
 *   ../frontend/public/sound/tts/openai-narrator-female.mp3
 */

import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

const MODEL = 'gpt-4o-mini-tts';
const INSTRUCTIONS = 'Speak as a refined British fantasy audiobook narrator. Calm, immersive, measured, and elegant. Use clear pronunciation, restrained drama, and natural pauses. Do not sound like an assistant or announcer.';
const SAMPLE_TEXT = 'The wizard raises a glowing staff as the adventure begins.';

const SAMPLES = [
  { filename: 'openai-narrator-male.mp3', voice: 'fable' },
  { filename: 'openai-narrator-female.mp3', voice: 'sage' },
] as const;

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set in environment.');
    process.exit(1);
  }

  const client = new OpenAI({ apiKey });
  const outDir = path.resolve(process.cwd(), '../frontend/public/sound/tts');
  fs.mkdirSync(outDir, { recursive: true });

  for (const sample of SAMPLES) {
    const outPath = path.join(outDir, sample.filename);
    if (fs.existsSync(outPath)) {
      console.log(`Skipping existing sample: ${outPath}`);
      continue;
    }

    console.log(`Generating ${sample.filename} with ${sample.voice}...`);
    const response = await client.audio.speech.create({
      model: MODEL,
      voice: sample.voice,
      input: SAMPLE_TEXT,
      instructions: INSTRUCTIONS,
      response_format: 'mp3',
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outPath, buffer);
    console.log(`  -> saved ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
