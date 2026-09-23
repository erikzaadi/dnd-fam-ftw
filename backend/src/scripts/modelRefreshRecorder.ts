/**
 * Shared by the paid model-refresh check scripts (checkPreviewHelpers.ts,
 * smokePreviewTurns.ts). Wraps the shared OpenAI client singleton so every
 * physical chat completion request made through production code paths is
 * recorded and counted against the script's request ceiling. Streaming
 * requests (chat.completions.stream) go through the same create() call.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createOpenAIClient, getOpenAIMaxRetries } from '../providers/ai/openAiClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MODEL_REFRESH_OUT_DIR = path.join(__dirname, '..', '..', 'data', 'model-refresh');

export type RecordedRequest = {
  label: string;
  model: string;
  stream: boolean;
  maxCompletionTokens: number | null;
  maxTokens: number | null;
  reasoningEffort: string | null;
  hasTemperature: boolean;
  durationMs: number;
  // Non-streaming requests only; streaming outcomes live in agent diagnostics.
  finishReason: string | null;
  content: string | null;
  usage: unknown;
  error: string | null;
};

type CreateFn = (body: Record<string, unknown>, options?: unknown) => Promise<unknown>;

export function preflight(scriptName: string): void {
  if (process.env.OPENAI_MAX_RETRIES !== '0' || getOpenAIMaxRetries() !== 0) {
    console.error(`[${scriptName}] OPENAI_MAX_RETRIES must be exported as 0 before starting this script`);
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error(`[${scriptName}] OPENAI_API_KEY is not set`);
    process.exit(1);
  }
}

export function gitRevision(): { revision: string | null; dirty: boolean | null } {
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim().length > 0;
    return { revision, dirty };
  } catch {
    return { revision: null, dirty: null };
  }
}

export function appendRecord(fileName: string, record: unknown): void {
  fs.mkdirSync(MODEL_REFRESH_OUT_DIR, { recursive: true });
  fs.appendFileSync(path.join(MODEL_REFRESH_OUT_DIR, fileName), `${JSON.stringify(record)}\n`);
}

// Installs the recorder once. getLabel names the case a request belongs to.
// Throws before sending when the ceiling would be exceeded, so the caller's
// normal error path (usually a fallback) runs and the case is reported failed.
export function installRequestRecorder(options: {
  maxRequests: number;
  getLabel: () => string;
  onRequest: (request: RecordedRequest) => void;
}): { started: () => number } {
  const completions = createOpenAIClient().chat.completions as unknown as { create: CreateFn };
  const original = completions.create.bind(completions);
  let started = 0;

  completions.create = async (body, requestOptions) => {
    const label = options.getLabel();
    if (started >= options.maxRequests) {
      throw new Error(`request ceiling ${options.maxRequests} reached`);
    }
    started++;
    const start = Date.now();
    const base = {
      label,
      model: String(body.model),
      stream: body.stream === true,
      maxCompletionTokens: typeof body.max_completion_tokens === 'number' ? body.max_completion_tokens : null,
      maxTokens: typeof body.max_tokens === 'number' ? body.max_tokens : null,
      reasoningEffort: typeof body.reasoning_effort === 'string' ? body.reasoning_effort : null,
      hasTemperature: 'temperature' in body,
    };
    try {
      const response = await original(body, requestOptions);
      const choice = base.stream
        ? undefined
        : (response as { choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null } }> }).choices?.[0];
      options.onRequest({
        ...base,
        durationMs: Date.now() - start,
        finishReason: choice?.finish_reason ?? null,
        content: choice?.message?.content ?? null,
        usage: base.stream ? null : (response as { usage?: unknown }).usage ?? null,
        error: null,
      });
      return response;
    } catch (err) {
      options.onRequest({
        ...base,
        durationMs: Date.now() - start,
        finishReason: null,
        content: null,
        usage: null,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };

  return { started: () => started };
}

export function parseModelArg(argv: string[], fallback: string): string {
  const index = argv.indexOf('--model');
  if (index === -1) {
    return fallback;
  }
  const model = argv[index + 1];
  if (!model || model.startsWith('--')) {
    console.error('--model requires a value');
    process.exit(1);
  }
  return model;
}
