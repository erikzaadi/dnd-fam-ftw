/**
 * Generates the static narrator audio bundled with the frontend: car-mode phrases
 * and one Settings sample per voice.
 * Run from backend/: npm run generate-tts-assets  (add "-- --force" to regenerate existing files)
 * (--conditions=source reads the shared package from src; without it a stale shared build is used.)
 *
 * Generates, for every voice the configured narrator can speak:
 *   frontend/public/sound/tts-phrases/{voice}/{slug}.mp3
 *   frontend/public/sound/tts/{voice}-sample.mp3
 *
 * Uses the same model, narrator instruction and wording check as live narration
 * (services/ttsService.ts), so bundled phrases match what players hear in play.
 *
 * Skips files that already exist (idempotent), so a new voice only costs its own
 * files. Pass --force to regenerate everything, e.g. after the narrator changes.
 * Paid: each file is one narration request. Commit the generated MP3s.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { OpenAiTtsVoice } from '@dnd-fam-ftw/shared';
import { generateSpeech } from '../services/ttsService.js';
import { resolveTtsTarget } from '../services/ttsTarget.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_PUBLIC = path.join(__dirname, '..', '..', '..', 'frontend', 'public');
const PHRASES_OUT_DIR = path.join(FRONTEND_PUBLIC, 'sound', 'tts-phrases');
const SAMPLES_OUT_DIR = path.join(FRONTEND_PUBLIC, 'sound', 'tts');

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
  // Freeform-first prompts (ideas on demand). Keep in sync with carSpeechSegment.ts.
  { slug: 'orientation-v2', text: 'Say what your hero tries, in your own words. Say ideas for suggestions, or help for voice commands.' },
  { slug: 'help-v3', text: 'Voice commands: ideas, ask the DM and your question, repeat story, status, party, gear, encounter, where are we, pause, resume, cancel, confirm, wrap up, end here, or say an option number.' },
  { slug: 'open-action', text: 'What do you try? Say it in your own words, or say ideas for suggestions.' },
];

const SAMPLE_TEXT =
  'The lantern flickers as the party descends into the crypt. Stone gives way to shadow, and somewhere below, something ancient stirs.';

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set in environment.');
    process.exit(1);
  }

  const force = process.argv.includes('--force');
  const target = resolveTtsTarget();
  console.log(`Narrator: ${target.model} (${target.strategy}), voices: ${target.voices.join(', ')}${force ? ', regenerating existing files' : ''}`);

  let generated = 0;
  let skipped = 0;

  const writeAsset = async (outPath: string, label: string, text: string, voice: OpenAiTtsVoice) => {
    if (!force && fs.existsSync(outPath)) {
      console.log(`Skipping: ${label}`);
      skipped++;
      return;
    }
    console.log(`Generating: ${label} ...`);
    const buffer = await generateSpeech(text, voice, { recordUsage: false });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buffer);
    console.log(`  -> saved (${(buffer.length / 1024).toFixed(1)} KB)`);
    generated++;
  };

  for (const voice of target.voices) {
    for (const phrase of STATIC_PHRASES) {
      await writeAsset(path.join(PHRASES_OUT_DIR, voice, `${phrase.slug}.mp3`), `tts-phrases/${voice}/${phrase.slug}.mp3`, phrase.text, voice);
    }
  }
  for (const voice of target.voices) {
    await writeAsset(path.join(SAMPLES_OUT_DIR, `${voice}-sample.mp3`), `tts/${voice}-sample.mp3`, SAMPLE_TEXT, voice);
  }

  console.log(`\nDone. Generated ${generated}, skipped ${skipped}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
