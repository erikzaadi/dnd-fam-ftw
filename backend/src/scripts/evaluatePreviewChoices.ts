/**
 * Bounded, opt-in live evaluation of the preview-tier choices flow for the
 * model refresh (next-up-instructions/model-refresh-02-live-validation.md).
 *
 * Makes PAID provider requests. Never run from unit tests. Run from backend/:
 *
 *   OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/evaluatePreviewChoices.ts --label baseline-nano
 *
 * OPENAI_MAX_RETRIES must be exported as 0 before the process starts (node's
 * --env-file does not override variables that are already set), so every
 * physical provider request is counted against the budget.
 *
 * Options:
 *   --label <name>                 Run label recorded in results (required)
 *   --config <name>:<K=V,K=V>      Named configuration with per-run env overrides; repeat to
 *                                  interleave configurations. Only OPENAI_MODEL_*,
 *                                  OPENAI_REASONING_EFFORT_*, OPENAI_TEXT_VERBOSITY_*, and
 *                                  OPENAI_SERVICE_TIER_* keys are allowed. Default: one
 *                                  configuration named after --label with no overrides.
 *   --repeat <n>                   Passes over the fixture set (default 3)
 *   --fixtures <id,id>             Restrict to these fixture ids (default: all 20)
 *   --max-requests <n>             Physical request ceiling (default 120 per configuration)
 *   --out-dir <path>               Results directory (default backend/data/model-refresh)
 *   --dry-run                      Print the plan and worst-case request count, make no calls
 *
 * Calls runChoicesWithRetry(), the same choices flow production uses: one
 * preview request plus at most one narration-tier retry per attempt. It never
 * runs narration, combat, inventory, or recovery agents.
 */

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getModelForTier, getOpenAIMaxRetries } from '../providers/ai/openAiClient.js';
import {
  runChoicesWithRetry,
  type ChoicesRequestInfo,
  type StructuredRequestMeasurement,
} from '../services/dmTurnOrchestrator.js';
import {
  MODEL_REFRESH_CHOICES_FIXTURES,
  MODEL_REFRESH_FIXTURE_VERSION,
  type ChoicesFixture,
} from '../tests/fixtures/model-refresh-choices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.join(__dirname, '..', '..', 'data', 'model-refresh');
const DEFAULT_REPEAT = 3;
const REQUESTS_PER_SAMPLE = 120;
const MAX_REQUESTS_PER_ATTEMPT = 2;
const REQUEST_SETTLE_MS = 2000;
const ALLOWED_OVERRIDE_RE = /^OPENAI_(MODEL|REASONING_EFFORT|TEXT_VERBOSITY|SERVICE_TIER)_[A-Z]+$/;

type EvalConfig = { name: string; env: Record<string, string> };
type RequestRecord = ChoicesRequestInfo & StructuredRequestMeasurement;

type AttemptRecord = {
  type: 'attempt';
  runId: string;
  config: string;
  fixtureId: string;
  fixtureHash: string;
  category: string;
  deadline: ChoicesFixture['deadline'];
  repeat: number;
  startedAt: string;
  durationMs: number;
  escalated: boolean;
  usedFallback: boolean;
  initialValid: boolean;
  initialDeadlineMet: boolean;
  initialIssues: { stale: boolean; lacksTopStat: boolean } | null;
  initial: unknown;
  final: unknown;
  diagnostics: unknown;
  requests: RequestRecord[];
  unfinishedRequests: number;
};

function fail(message: string): never {
  console.error(`[eval] ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const args = {
    label: '',
    configs: [] as EvalConfig[],
    repeat: DEFAULT_REPEAT,
    fixtureIds: null as string[] | null,
    maxRequests: null as number | null,
    outDir: DEFAULT_OUT_DIR,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) {
        fail(`Missing value for ${flag}`);
      }
      return next;
    };
    switch (flag) {
    case '--label':
      args.label = value();
      break;
    case '--config':
      args.configs.push(parseConfig(value()));
      break;
    case '--repeat':
      args.repeat = parsePositiveInt(flag, value());
      break;
    case '--fixtures':
      args.fixtureIds = value().split(',').map(id => id.trim()).filter(Boolean);
      break;
    case '--max-requests':
      args.maxRequests = parsePositiveInt(flag, value());
      break;
    case '--out-dir':
      args.outDir = path.resolve(value());
      break;
    case '--dry-run':
      args.dryRun = true;
      break;
    default:
      fail(`Unknown option ${flag}`);
    }
  }
  if (!args.label) {
    fail('--label is required');
  }
  if (args.configs.length === 0) {
    args.configs.push({ name: args.label, env: {} });
  }
  if (new Set(args.configs.map(c => c.name)).size !== args.configs.length) {
    fail('Configuration names must be unique');
  }
  return args;
}

function parsePositiveInt(flag: string, value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    fail(`${flag} expects a positive integer, got "${value}"`);
  }
  return Number(value);
}

function parseConfig(spec: string): EvalConfig {
  const separator = spec.indexOf(':');
  const name = separator === -1 ? spec : spec.slice(0, separator);
  const pairs = separator === -1 ? '' : spec.slice(separator + 1);
  if (!name) {
    fail(`Invalid --config "${spec}": missing name`);
  }
  const env: Record<string, string> = {};
  for (const pair of pairs.split(',').filter(Boolean)) {
    const eq = pair.indexOf('=');
    const key = eq === -1 ? '' : pair.slice(0, eq);
    if (!ALLOWED_OVERRIDE_RE.test(key)) {
      fail(`Invalid --config override "${pair}". Allowed keys: OPENAI_MODEL_*, OPENAI_REASONING_EFFORT_*, OPENAI_TEXT_VERBOSITY_*, OPENAI_SERVICE_TIER_*`);
    }
    env[key] = pair.slice(eq + 1);
  }
  return { name, env };
}

// Overrides are read per request (getModelForTier and friends read process.env
// at call time), so configurations can be interleaved in one process.
// Client-level settings (API key, base URL, retries) are never overridden.
async function withConfigEnv<T>(config: EvalConfig, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(config.env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function fixtureHash(fixture: ChoicesFixture): string {
  const payload = JSON.stringify({
    version: MODEL_REFRESH_FIXTURE_VERSION,
    id: fixture.id,
    deadline: fixture.deadline,
    expectedFacts: fixture.expectedFacts,
    input: fixture.build(),
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function gitRevision(): { revision: string | null; dirty: boolean | null } {
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
    return { revision, dirty };
  } catch {
    return { revision: null, dirty: null };
  }
}

// Nearest-rank percentile; failed attempts are Infinity so they cannot improve p95.
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function formatMs(value: number | null): string {
  if (value === null) {
    return '-';
  }
  return Number.isFinite(value) ? `${Math.round(value)}` : 'inf';
}

function rate(count: number, total: number): string {
  return total === 0 ? '-' : `${count}/${total} (${((count / total) * 100).toFixed(1)}%)`;
}

async function waitForRequests(isSettled: () => boolean): Promise<void> {
  const deadline = Date.now() + REQUEST_SETTLE_MS;
  while (!isSettled() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

async function runAttempt(
  runId: string,
  config: EvalConfig,
  fixture: ChoicesFixture,
  hash: string,
  repeat: number,
  onRequestStart: () => void,
): Promise<AttemptRecord> {
  const requests: RequestRecord[] = [];
  let started = 0;
  const startedAt = new Date();
  const result = await withConfigEnv(config, () => runChoicesWithRetry(fixture.build(), {
    observer: {
      onRequestStart: () => {
        started++;
        onRequestStart();
      },
      onRequestEnd: (event) => {
        requests.push(event);
      },
    },
  }));
  // Deadline-aborted streams report their end shortly after the flow returns.
  await waitForRequests(() => requests.length >= started);
  const initialDiagnostic = result.diagnostics.find(d => d.agent === 'choices');
  return {
    type: 'attempt',
    runId,
    config: config.name,
    fixtureId: fixture.id,
    fixtureHash: hash,
    category: fixture.category,
    deadline: fixture.deadline,
    repeat,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    escalated: result.escalated,
    usedFallback: result.usedFallback,
    initialValid: result.initial !== null,
    initialDeadlineMet: initialDiagnostic?.status === 'ok' || initialDiagnostic?.status === 'retry',
    initialIssues: result.initialIssues,
    initial: result.initial,
    final: result.choices,
    diagnostics: result.diagnostics,
    requests,
    unfinishedRequests: started - requests.length,
  };
}

function summarize(attempts: AttemptRecord[]) {
  const initialRequests = attempts.map(a => a.requests.find(r => r.agent === 'choices') ?? null);
  const completion = attempts.map((a, i) => (a.initialValid ? initialRequests[i]?.completionMs ?? Infinity : Infinity));
  const firstContent = initialRequests.map(r => r?.firstContentMs ?? Infinity);
  const byDeadline = (deadline: ChoicesFixture['deadline']) =>
    completion.filter((_, i) => attempts[i].deadline === deadline);
  const tokens = attempts.flatMap(a => a.requests).reduce((sum, r) => sum + (r.usage?.total_tokens ?? 0), 0);
  return {
    attempts: attempts.length,
    requests: attempts.reduce((sum, a) => sum + a.requests.length + a.unfinishedRequests, 0),
    initialValid: attempts.filter(a => a.initialValid).length,
    initialDeadlineMisses: attempts.filter(a => !a.initialDeadlineMet).length,
    escalated: attempts.filter(a => a.escalated).length,
    fallback: attempts.filter(a => a.usedFallback).length,
    truncated: initialRequests.filter(r => r?.finishReason === 'length').length,
    // Never streamed any content; deadline-aborted streams that started are counted as deadline misses.
    missingContent: initialRequests.filter(r => !r || r.firstContentMs === null).length,
    stale: attempts.filter(a => a.initialIssues?.stale).length,
    lacksTopStat: attempts.filter(a => a.initialIssues?.lacksTopStat).length,
    unfinishedRequests: attempts.reduce((sum, a) => sum + a.unfinishedRequests, 0),
    completionP50: percentile(completion, 0.5),
    completionP95Ordinary: percentile(byDeadline('ordinary'), 0.95),
    completionP95Relaxed: percentile(byDeadline('relaxed'), 0.95),
    firstContentP50: percentile(firstContent, 0.5),
    firstContentP95: percentile(firstContent, 0.95),
    totalTokens: tokens,
  };
}

function printSummary(name: string, summary: ReturnType<typeof summarize>) {
  console.log(`\n== ${name}`);
  console.log(`  attempts               ${summary.attempts} (physical requests ${summary.requests})`);
  console.log(`  initial valid          ${rate(summary.initialValid, summary.attempts)}`);
  console.log(`  initial deadline miss  ${rate(summary.initialDeadlineMisses, summary.attempts)}`);
  console.log(`  escalation             ${rate(summary.escalated, summary.attempts)}`);
  console.log(`  final fallback         ${rate(summary.fallback, summary.attempts)}`);
  console.log(`  truncated / no content ${summary.truncated} / ${summary.missingContent}`);
  console.log(`  stale / lacks top stat ${summary.stale} / ${summary.lacksTopStat}`);
  console.log(`  completion p50         ${formatMs(summary.completionP50)} ms`);
  console.log(`  completion p95         ordinary ${formatMs(summary.completionP95Ordinary)} ms, relaxed ${formatMs(summary.completionP95Relaxed)} ms`);
  console.log(`  first content p50/p95  ${formatMs(summary.firstContentP50)} / ${formatMs(summary.firstContentP95)} ms (report-only)`);
  console.log(`  total tokens           ${summary.totalTokens}`);
  if (summary.unfinishedRequests > 0) {
    console.log(`  WARNING: ${summary.unfinishedRequests} request(s) never reported completion`);
  }
}

function scoringSheet(runId: string, attempts: AttemptRecord[], fixtures: ChoicesFixture[]): string {
  const facts = new Map(fixtures.map(f => [f.id, f.expectedFacts]));
  const lines = [
    `# Choices scoring sheet: ${runId}`,
    '',
    'Score the raw initial output against checklist items 1-6 in model-refresh-02-live-validation.md.',
    'Missing initial output fails every item. Record invented completed state transitions separately.',
    '',
  ];
  for (const attempt of attempts) {
    lines.push(`## ${attempt.config} / ${attempt.fixtureId} / repeat ${attempt.repeat}`, '');
    for (const fact of facts.get(attempt.fixtureId) ?? []) {
      lines.push(`- Expected: ${fact}`);
    }
    lines.push('', '```json', JSON.stringify(attempt.initial, null, 2), '```', '');
    lines.push(
      `Automated: valid=${attempt.initialValid} stale=${attempt.initialIssues?.stale ?? '-'} lacksTopStat=${attempt.initialIssues?.lacksTopStat ?? '-'}`,
      '',
      '- [ ] 1 schema  - [ ] 2 actionable  - [ ] 3 scene/encounter  - [ ] 4 top stat  - [ ] 5 fresh  - [ ] 6 no invented facts',
      '- Invented completed state transition: no',
      '- Notes:',
      '',
    );
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = args.fixtureIds
    ? args.fixtureIds.map(id => MODEL_REFRESH_CHOICES_FIXTURES.find(f => f.id === id) ?? fail(`Unknown fixture id "${id}"`))
    : [...MODEL_REFRESH_CHOICES_FIXTURES];
  const maxRequests = args.maxRequests ?? REQUESTS_PER_SAMPLE * args.configs.length;
  const plannedAttempts = fixtures.length * args.repeat * args.configs.length;
  const worstCaseRequests = plannedAttempts * MAX_REQUESTS_PER_ATTEMPT;

  console.log(`[eval] label=${args.label} configs=${args.configs.map(c => c.name).join(',')} fixtures=${fixtures.length} repeat=${args.repeat}`);
  console.log(`[eval] planned attempts=${plannedAttempts} worst-case requests=${worstCaseRequests} ceiling=${maxRequests}`);
  if (args.dryRun) {
    for (const config of args.configs) {
      console.log(`[eval] config ${config.name}: ${JSON.stringify(config.env)}`);
    }
    console.log('[eval] dry run: no provider calls made');
    return;
  }

  // Preflight before any SDK call: the client singleton reads retries once.
  if (process.env.OPENAI_MAX_RETRIES !== '0' || getOpenAIMaxRetries() !== 0) {
    fail('OPENAI_MAX_RETRIES must be exported as 0 before starting this script');
  }
  if (!process.env.OPENAI_API_KEY) {
    fail('OPENAI_API_KEY is not set');
  }

  const runId = `${args.label}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.mkdirSync(args.outDir, { recursive: true });
  const runsFile = path.join(args.outDir, 'runs.jsonl');
  const append = (record: unknown) => fs.appendFileSync(runsFile, `${JSON.stringify(record)}\n`);
  const hashes = new Map(fixtures.map(f => [f.id, fixtureHash(f)]));

  append({
    type: 'run',
    runId,
    label: args.label,
    startedAt: new Date().toISOString(),
    git: gitRevision(),
    fixtureVersion: MODEL_REFRESH_FIXTURE_VERSION,
    fixtureHashes: Object.fromEntries(hashes),
    repeat: args.repeat,
    maxRequests,
    maxRetries: 0,
    retryNote: 'Evaluation disables SDK retries; production uses the SDK default unless OPENAI_MAX_RETRIES is set.',
    baseUrlConfigured: !!process.env.OPENAI_BASE_URL,
    configs: args.configs.map(config => ({
      name: config.name,
      overrides: config.env,
      previewModel: config.env.OPENAI_MODEL_PREVIEW ?? getModelForTier('preview'),
      narrationModel: config.env.OPENAI_MODEL_NARRATION ?? getModelForTier('narration'),
    })),
  });

  // Interleave configurations per fixture so provider conditions are shared.
  const schedule = Array.from({ length: args.repeat }, (_, i) => i + 1).flatMap(repeat =>
    fixtures.flatMap(fixture => args.configs.map(config => ({ repeat, fixture, config }))));
  const attempts: AttemptRecord[] = [];
  let requestsStarted = 0;
  let stoppedAtCeiling = false;
  for (const { repeat, fixture, config } of schedule) {
    if (requestsStarted + MAX_REQUESTS_PER_ATTEMPT > maxRequests) {
      stoppedAtCeiling = true;
      break;
    }
    const attempt = await runAttempt(runId, config, fixture, hashes.get(fixture.id) as string, repeat, () => {
      requestsStarted++;
    });
    attempts.push(attempt);
    append(attempt);
    const status = attempt.usedFallback ? 'FALLBACK' : attempt.escalated ? 'escalated' : 'ok';
    console.log(`[eval] ${attempts.length}/${plannedAttempts} ${config.name} ${fixture.id} r${repeat}: ${status} (${attempt.durationMs} ms)`);
  }

  const summaries = Object.fromEntries(args.configs.map(config => [
    config.name,
    summarize(attempts.filter(a => a.config === config.name)),
  ]));
  append({
    type: 'summary',
    runId,
    finishedAt: new Date().toISOString(),
    complete: !stoppedAtCeiling,
    requestsStarted,
    summaries,
  });
  for (const [name, summary] of Object.entries(summaries)) {
    printSummary(name, summary);
  }

  const sheetFile = path.join(args.outDir, `score-${runId}.md`);
  fs.writeFileSync(sheetFile, scoringSheet(runId, attempts, fixtures));
  if (stoppedAtCeiling) {
    console.log(`\n[eval] INCOMPLETE: stopped at the ${maxRequests}-request ceiling after ${attempts.length}/${plannedAttempts} attempts`);
  }
  console.log(`\n[eval] physical requests started: ${requestsStarted}`);
  console.log(`[eval] results appended to ${runsFile}`);
  console.log(`[eval] manual scoring sheet: ${sheetFile}`);
}

main().catch((err: unknown) => {
  console.error('[eval] failed:', err);
  process.exit(1);
});
