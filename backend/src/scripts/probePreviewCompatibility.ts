/**
 * Day-one compatibility probes for the model refresh
 * (next-up-instructions/model-refresh-01-preview-compatibility.md).
 *
 * Makes at most FOUR paid text requests: the image-brief and DM-prep request
 * shapes, each with reasoning_effort "none" and max_completion_tokens, once
 * with the old temperature and once without. No images are generated. Run
 * from backend/:
 *
 *   OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/probePreviewCompatibility.ts [--model gpt-5.6-luna]
 *
 * The application omits temperature unconditionally; these probes only record
 * whether the candidate accepts the new request shape. An error or empty
 * reply WITHOUT temperature blocks the candidate configuration; a non-empty
 * reply cut off by the token cap is reported separately as a cap problem.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { IMAGE_BRIEF_SYSTEM_PROMPT } from '../providers/ai/images/imageBriefProvider.js';
import { createOpenAIClient, getOpenAIMaxRetries } from '../providers/ai/openAiClient.js';
import { DM_PREP_SYSTEM_PROMPT } from '../services/dmPrepCompilationService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, '..', '..', 'data', 'model-refresh', 'probes.jsonl');

// Production system prompts and user-message formats with sample inputs.
// The probes check parameter compatibility, not quality.
const SHAPES = [
  {
    name: 'image-brief',
    maxCompletionTokens: 60,
    temperature: 0.5,
    messages: [
      { role: 'system' as const, content: IMAGE_BRIEF_SYSTEM_PROMPT },
      { role: 'user' as const, content: 'Scene: A rope bridge over a misty gorge\nActing character: Brom Ironbread\nTension: high\n\nNarration:\nBrom shoulders his shield and charges the goblin slinger as the bridge sways.' },
    ],
  },
  {
    name: 'dm-prep',
    maxCompletionTokens: 200,
    temperature: 0.3,
    messages: [
      { role: 'system' as const, content: DM_PREP_SYSTEM_PROMPT },
      { role: 'user' as const, content: 'Summarize this campaign brief into 3-5 sentences:\n\nA stolen dragon egg is hidden somewhere in the harbor town of Saltmere. The harbor master, Old Quill, knows more than he says. The smugglers of the Grey Gull guild want to sell the egg before the mother dragon returns at the next full moon.' },
    ],
  },
];

function parseModel(argv: string[]): string {
  const index = argv.indexOf('--model');
  if (index === -1) {
    return 'gpt-5.6-luna';
  }
  const model = argv[index + 1];
  if (!model) {
    console.error('[probe] --model requires a value');
    process.exit(1);
  }
  return model;
}

async function main() {
  const model = parseModel(process.argv.slice(2));
  if (process.env.OPENAI_MAX_RETRIES !== '0' || getOpenAIMaxRetries() !== 0) {
    console.error('[probe] OPENAI_MAX_RETRIES must be exported as 0 before starting this script');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('[probe] OPENAI_API_KEY is not set');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const client = createOpenAIClient();
  let blocked = false;
  let capTruncated = false;

  for (const shape of SHAPES) {
    for (const withTemperature of [true, false]) {
      const start = Date.now();
      const record: Record<string, unknown> = {
        type: 'probe',
        at: new Date().toISOString(),
        model,
        shape: shape.name,
        withTemperature,
        baseUrlConfigured: !!process.env.OPENAI_BASE_URL,
      };
      try {
        const response = await client.chat.completions.create({
          model,
          messages: shape.messages,
          max_completion_tokens: shape.maxCompletionTokens,
          reasoning_effort: 'none',
          ...(withTemperature ? { temperature: shape.temperature } : {}),
        }, { signal: AbortSignal.timeout(20_000) });
        const choice = response.choices[0];
        const content = choice?.message?.content?.trim() ?? '';
        Object.assign(record, {
          ok: true,
          durationMs: Date.now() - start,
          finishReason: choice?.finish_reason ?? null,
          nonEmpty: content.length > 0,
          content,
          usage: response.usage ?? null,
        });
        if (!withTemperature && !content) {
          blocked = true;
        } else if (choice?.finish_reason === 'length') {
          capTruncated = true;
        }
      } catch (err) {
        const e = err as { status?: number; code?: string; message?: string };
        Object.assign(record, {
          ok: false,
          durationMs: Date.now() - start,
          status: e.status ?? null,
          code: e.code ?? null,
          error: e.message ?? String(err),
        });
        if (!withTemperature) {
          blocked = true;
        }
      }
      fs.appendFileSync(OUT_FILE, `${JSON.stringify(record)}\n`);
      const outcome = record.ok
        ? `ok finish=${String(record.finishReason)} nonEmpty=${String(record.nonEmpty)}`
        : `ERROR status=${String(record.status)} ${String(record.error)}`;
      console.log(`[probe] ${model} ${shape.name} temperature=${withTemperature ? 'yes' : 'no'}: ${outcome} (${String(record.durationMs)} ms)`);
    }
  }

  console.log(`[probe] results appended to ${OUT_FILE}`);
  if (capTruncated) {
    console.log('[probe] CAP: a non-empty reply was cut off by max_completion_tokens. The request shape works; review that caller\'s token cap.');
  }
  if (blocked) {
    console.log('[probe] BLOCKED: a request without temperature failed or returned empty output. Investigate before using this candidate.');
    process.exit(2);
  }
}

main().catch((err: unknown) => {
  console.error('[probe] failed:', err);
  process.exit(1);
});
