/**
 * One-off probe for the OpenAI TTS retirement migration
 * (next-up-instructions/tts-model-retirement-migration-plan.md, step 1).
 *
 * Paid, but bounded. The listening round makes three Realtime narrations of one riddle paragraph.
 * Expected cost is under $0.10. Use a dev key.
 *
 * Run from backend/:
 *   npx tsx --env-file=../.env src/scripts/probeTtsReplacement.ts
 *
 * Output: ../temp/tts-probe/ (riddle-*.mp3 and riddle-*.wav to listen to, plus summary-ash.json)
 */

import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

const REALTIME_MODEL = 'gpt-realtime-2.1-mini';
const NARRATOR = 'Speak as a refined British fantasy audiobook narrator. Calm, immersive, measured, and elegant. Use clear pronunciation, restrained drama, and natural pauses. Do not sound like an assistant or announcer.';
const VERBATIM = 'You are a text-to-speech reader, not a conversational assistant. The user message is a script. Your entire spoken output must be that script and nothing else: your first spoken word is the first word of the script and your last spoken word is its last word. Never announce, acknowledge, greet, reply, comment, summarize, add, omit, or reorder anything.';
const RIDDLE_TEXT = 'The wood whispers: "I dance on strings, but never play - what am I?" Wobblehat counts 3 silver coins, 12 acorns, and one cracked lantern. Zara of Thistledown answers, "A puppet!" and the old oak creaks open.';
const FLAIR = 'Speak as a master fantasy storyteller reading an audiobook by firelight. Warm, vivid and expressive, with a sense of wonder, a hint of mischief, and quiet menace where the story calls for it. Give quoted character lines a touch of their own personality. Measured pace with natural pauses; finish every word and sentence fully. Do not sound like an assistant or announcer.';
const EPIC = 'Speak as the grand narrator of an epic fantasy saga: deep, booming, theatrical and gloriously over-serious, as if every sentence were carved in stone. Relish the dramatic words, build towards the big moments, and let ominous pauses hang. Play it completely straight; the grandeur is what makes it fun. Give quoted character lines their own personality. Finish every word and sentence fully. Do not sound like an assistant or announcer.';
const BLEND = 'Speak as the narrator of an epic fantasy saga told by firelight: rich, theatrical and a little over-serious, relishing the dramatic words and letting ominous pauses hang, but warm rather than booming, so it stays pleasant across a whole evening. Play it straight. Give quoted character lines their own personality. Finish every word and sentence fully. Do not sound like an assistant or announcer.';
// Ash round: `ash` won the epic round (2026-10-08); compare instruction wordings on it.
const LISTENING_REALTIME = [
  { label: 'ash-flair', voice: 'ash', narrator: FLAIR },
  { label: 'ash-blend', voice: 'ash', narrator: BLEND },
  { label: 'ash-epic-take2', voice: 'ash', narrator: EPIC },
];
const LISTENING_BASELINE: { label: string; voice: string; narrator: string }[] = [];
const BASELINE_MODEL = 'gpt-4o-mini-tts';
const TIMEOUT_MS = 45_000;
const outDir = path.resolve(process.cwd(), '../temp/tts-probe');

type Summary = Record<string, unknown>;

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function wordDistance(a: string[], b: string[]): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = current;
    }
  }
  return row[b.length];
}

function wav(pcm: Buffer, rate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function openRealtime(apiKey: string): WebSocket {
  // Subprotocol auth keeps this on Node's built-in WebSocket (no `ws` dependency for a one-off probe).
  return new WebSocket(`wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`, ['realtime', `openai-insecure-api-key.${apiKey}`]);
}

function sessionConfig(voice: string, narrator = NARRATOR) {
  return {
    type: 'realtime',
    model: REALTIME_MODEL,
    instructions: `${VERBATIM} ${narrator}`,
    output_modalities: ['audio'],
    audio: { output: { voice, format: { type: 'audio/pcm', rate: 24000 } } },
  };
}

function narrateRealtime(apiKey: string, label: string, voice: string, narrator: string): Promise<Summary> {
  return new Promise(resolve => {
    const started = Date.now();
    const pcm: Buffer[] = [];
    const eventTypes = new Set<string>();
    let transcript = '';
    let firstAudioMs: number | null = null;
    const ws = openRealtime(apiKey);
    const finish = (result: Summary) => {
      clearTimeout(timer);
      ws.close();
      const audio = Buffer.concat(pcm);
      const file = path.join(outDir, `riddle-realtime-${label}.wav`);
      if (audio.length > 0) {
        fs.writeFileSync(file, wav(audio));
      }
      const expected = words(RIDDLE_TEXT);
      const spoken = words(transcript);
      resolve({
        ...result,
        totalMs: Date.now() - started,
        firstAudioMs,
        audioSeconds: audio.length / 48000,
        wavBytes: audio.length + 44,
        file: audio.length > 0 ? file : null,
        modelTranscript: transcript,
        wordEdits: wordDistance(expected, spoken),
        expectedWords: expected.length,
        eventTypes: [...eventTypes].sort(),
      });
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), TIMEOUT_MS);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'session.update', session: sessionConfig(voice, narrator) }));
      ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: RIDDLE_TEXT }] } }));
      ws.send(JSON.stringify({ type: 'response.create' }));
    });
    ws.addEventListener('message', message => {
      const event = JSON.parse(String(message.data));
      eventTypes.add(event.type);
      if (event.type === 'response.output_audio.delta' || event.type === 'response.audio.delta') {
        firstAudioMs ??= Date.now() - started;
        pcm.push(Buffer.from(event.delta, 'base64'));
      } else if (event.type === 'response.output_audio_transcript.delta' || event.type === 'response.audio_transcript.delta') {
        transcript += event.delta;
      } else if (event.type === 'response.done') {
        finish({ ok: event.response?.status === 'completed', status: event.response?.status, usage: event.response?.usage });
      } else if (event.type === 'error') {
        finish({ ok: false, error: event.error?.message ?? JSON.stringify(event.error) });
      }
    });
    ws.addEventListener('error', () => finish({ ok: false, error: 'websocket error' }));
  });
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set in environment.');
    process.exit(1);
  }
  if (process.env.OPENAI_BASE_URL) {
    console.warn(`OPENAI_BASE_URL is set (${process.env.OPENAI_BASE_URL}); this probe targets api.openai.com directly.`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const client = new OpenAI({ apiKey });

  // Step 1 checks (model list, /audio/speech candidates, voice acceptance) ran on
  // 2026-10-04; results are in the migration plan. This run is the listening round.
  const summary: Summary = { date: new Date().toISOString(), text: RIDDLE_TEXT };

  const baseline: Summary = {};
  for (const { label, voice, narrator } of LISTENING_BASELINE) {
    const started = Date.now();
    try {
      const response = await client.audio.speech.create({ model: BASELINE_MODEL, voice, input: RIDDLE_TEXT, instructions: narrator, response_format: 'mp3' });
      const file = path.join(outDir, `riddle-current-${label}.mp3`);
      fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      baseline[label] = { ok: true, ms: Date.now() - started, file };
    } catch (err) {
      baseline[label] = { ok: false, error: errorText(err) };
    }
    console.log('current model', label, JSON.stringify(baseline[label]));
  }
  summary.baseline = baseline;

  const realtime: Summary = {};
  for (const { label, voice, narrator } of LISTENING_REALTIME) {
    realtime[label] = await narrateRealtime(apiKey, label, voice, narrator);
    console.log('realtime', label, JSON.stringify(realtime[label]));
  }
  summary.realtime = realtime;

  fs.writeFileSync(path.join(outDir, 'summary-ash.json'), JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${path.join(outDir, 'summary-ash.json')}. Listen to the riddle-* files in ${outDir}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
