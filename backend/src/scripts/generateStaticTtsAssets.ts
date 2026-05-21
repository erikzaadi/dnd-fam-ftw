/**
 * One-time script to generate static TTS audio assets for car mode and settings.
 * Run from backend/: npx tsx --env-file=../.env src/scripts/generateStaticTtsAssets.ts
 *
 * Generates:
 *   frontend/public/sound/tts-phrases/{voice}/{slug}.mp3  (49 files: 7 voices x 7 phrases)
 *   frontend/public/sound/tts/{voice}-sample.mp3          (7 files: 1 per voice)
 *
 * Skips files that already exist (idempotent). Commit the generated MP3s.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { OPENAI_TTS_VOICES } from '@dnd-fam-ftw/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_PUBLIC = path.join(__dirname, '..', '..', '..', 'frontend', 'public');
const PHRASES_OUT_DIR = path.join(FRONTEND_PUBLIC, 'sound', 'tts-phrases');
const SAMPLES_OUT_DIR = path.join(FRONTEND_PUBLIC, 'sound', 'tts');

const TTS_MODEL = 'gpt-4o-mini-tts';
const NARRATOR_INSTRUCTIONS =
  'Speak as a refined British fantasy audiobook narrator. Calm, immersive, measured, and elegant. ' +
  'Use clear pronunciation, restrained drama, and natural pauses. Do not sound like an assistant or announcer.';

const STATIC_PHRASES: Array<{ slug: string; text: string }> = [
  {
    slug: 'choose-action',
    text: 'What do you do? Say option one, two, or three, or speak freely for a custom action.',
  },
  { slug: 'confirm-action', text: 'Say confirm, cancel, or try again.' },
  {
    slug: 'help',
    text: 'Voice commands: options, repeat story, status, party, gear, encounter, where are we, pause, resume, cancel, confirm, or say an option number.',
  },
  { slug: 'reconnecting', text: 'Reconnecting.' },
  { slug: 'reconnected', text: 'Reconnected. What do you do?' },
  { slug: 'retry-prompt', text: "I didn't hear anything. Please try again." },
  {
    slug: 'orientation',
    text: 'Say one, two, or three for the main options, or speak freely for a custom action. Say help at any time for voice commands.',
  },
];

const SAMPLE_TEXT =
  'The lantern flickers as the party descends into the crypt. Stone gives way to shadow, and somewhere below, something ancient stirs.';

async function generateMp3(client: OpenAI, text: string, voice: string): Promise<Buffer> {
  const response = await client.audio.speech.create({
    model: TTS_MODEL,
    voice: voice as OpenAI.Audio.Speech.SpeechCreateParams['voice'],
    input: text,
    instructions: NARRATOR_INSTRUCTIONS,
    response_format: 'mp3',
  });
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set in environment.');
    process.exit(1);
  }

  const client = new OpenAI({ apiKey });
  let generated = 0;
  let skipped = 0;

  // Car mode static phrases: 7 voices x 7 phrases = 49 files
  for (const voice of OPENAI_TTS_VOICES) {
    const voiceDir = path.join(PHRASES_OUT_DIR, voice);
    if (!fs.existsSync(voiceDir)) {
      fs.mkdirSync(voiceDir, { recursive: true });
    }
    for (const phrase of STATIC_PHRASES) {
      const outPath = path.join(voiceDir, `${phrase.slug}.mp3`);
      if (fs.existsSync(outPath)) {
        console.log(`Skipping: tts-phrases/${voice}/${phrase.slug}.mp3`);
        skipped++;
        continue;
      }
      console.log(`Generating: tts-phrases/${voice}/${phrase.slug}.mp3 ...`);
      const buffer = await generateMp3(client, phrase.text, voice);
      fs.writeFileSync(outPath, buffer);
      console.log(`  -> saved (${(buffer.length / 1024).toFixed(1)} KB)`);
      generated++;
    }
  }

  // Settings preview samples: 1 text x 7 voices = 7 files
  if (!fs.existsSync(SAMPLES_OUT_DIR)) {
    fs.mkdirSync(SAMPLES_OUT_DIR, { recursive: true });
  }
  for (const voice of OPENAI_TTS_VOICES) {
    const outPath = path.join(SAMPLES_OUT_DIR, `${voice}-sample.mp3`);
    if (fs.existsSync(outPath)) {
      console.log(`Skipping: tts/${voice}-sample.mp3`);
      skipped++;
      continue;
    }
    console.log(`Generating: tts/${voice}-sample.mp3 ...`);
    const buffer = await generateMp3(client, SAMPLE_TEXT, voice);
    fs.writeFileSync(outPath, buffer);
    console.log(`  -> saved (${(buffer.length / 1024).toFixed(1)} KB)`);
    generated++;
  }

  console.log(`\nDone. Generated ${generated}, skipped ${skipped}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
