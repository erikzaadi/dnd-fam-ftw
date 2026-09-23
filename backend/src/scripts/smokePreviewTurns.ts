/**
 * Paid full-turn smoke check for the model refresh
 * (next-up-instructions/model-refresh-02-live-validation.md). Runs six frozen
 * fixtures through the whole DmTurnOrchestrator (narration, choices with
 * retries and guards, and the combat/inventory/recovery agents the fixture
 * triggers) with the preview tier set to --model and reasoning_effort "none".
 * Verifies orchestration still works; it is not a quality benchmark. Run from
 * backend/:
 *
 *   OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/smokePreviewTurns.ts [--model gpt-5.6-luna] [--dry-run]
 *
 * About 4 requests per turn (ceiling 45 for the run). Results are appended to
 * data/model-refresh/smoke.jsonl.
 */

import {
  appendRecord,
  gitRevision,
  installRequestRecorder,
  parseModelArg,
  preflight,
  type RecordedRequest,
} from './modelRefreshRecorder.js';
import { MODEL_REFRESH_CHOICES_FIXTURES, MODEL_REFRESH_FIXTURE_VERSION } from '../tests/fixtures/model-refresh-choices.js';
import { DmTurnOrchestrator } from '../services/dmTurnOrchestrator.js';

const MAX_REQUESTS = 45;
// One per orchestrator path: plain exploration, active combat, encounter
// start signal, inventory, recovery, and a relaxed-deadline turn.
const SMOKE_FIXTURE_IDS = [
  'explore-corridor',
  'combat-active-bridge',
  'combat-zug-start',
  'trade-merchant',
  'heal-downed-ally',
  'relaxed-intervention',
];
const STATE_FIELDS = [
  'suggestedDamage',
  'suggestedEncounterStart',
  'suggestedEncounterUpdate',
  'suggestedInventoryAdd',
  'suggestedInventoryRemove',
  'suggestedInventoryUpdate',
  'suggestedRevive',
  'suggestedHeal',
  'suggestedBuffAdd',
  'suggestedBuffRemove',
];

async function main() {
  const argv = process.argv.slice(2);
  const model = parseModelArg(argv, 'gpt-5.6-luna');
  const dryRun = argv.includes('--dry-run');
  process.env.OPENAI_MODEL_PREVIEW = model;
  process.env.OPENAI_REASONING_EFFORT_PREVIEW = 'none';

  const fixtures = SMOKE_FIXTURE_IDS.map(id => {
    const fixture = MODEL_REFRESH_CHOICES_FIXTURES.find(f => f.id === id);
    if (!fixture) {
      throw new Error(`Unknown fixture id "${id}"`);
    }
    return fixture;
  });
  console.log(`[smoke] model=${model} reasoning=none turns=${fixtures.length} ceiling=${MAX_REQUESTS}`);
  if (dryRun) {
    console.log(`[smoke] fixtures: ${SMOKE_FIXTURE_IDS.join(', ')}`);
    console.log('[smoke] dry run: no provider calls made');
    return;
  }
  preflight('smoke');

  const runId = `smoke-${model}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  appendRecord('smoke.jsonl', {
    type: 'run', runId, startedAt: new Date().toISOString(), git: gitRevision(),
    model, reasoningEffort: 'none', maxRetries: 0, fixtureVersion: MODEL_REFRESH_FIXTURE_VERSION, fixtures: SMOKE_FIXTURE_IDS,
  });

  let currentLabel = '';
  let turnRequests: RecordedRequest[] = [];
  const recorder = installRequestRecorder({
    maxRequests: MAX_REQUESTS,
    getLabel: () => currentLabel,
    onRequest: (request) => turnRequests.push(request),
  });

  const orchestrator = new DmTurnOrchestrator();
  let failures = 0;
  for (const fixture of fixtures) {
    currentLabel = fixture.id;
    turnRequests = [];
    const start = Date.now();
    const result = await orchestrator.orchestrate(fixture.build());
    // Deadline-aborted streams may report shortly after the turn resolves.
    await new Promise(resolve => setTimeout(resolve, 500));
    const durationMs = Date.now() - start;

    const diagnostics = result.agentDiagnostics;
    const narrationDiag = diagnostics.find(d => d.agent === 'narration');
    const hardErrors = diagnostics.filter(d => d.errorKind && d.errorKind !== 'timeout');
    const previewRequests = turnRequests.filter(r => r.model === model);
    const otherRequests = turnRequests.filter(r => r.model !== model);
    const problems = [
      !result.narration?.trim() ? 'empty narration' : null,
      narrationDiag?.status !== 'ok' ? `narration ${narrationDiag?.status ?? 'missing'}` : null,
      result.choices.length !== 3 ? `${result.choices.length} choices` : null,
      ...hardErrors.map(d => `${d.agent} ${d.errorKind}: ${d.errorMessage ?? ''}`),
      previewRequests.length === 0 ? 'no preview-tier request' : null,
      previewRequests.some(r => r.reasoningEffort !== 'none' || r.hasTemperature) ? 'unexpected preview request settings' : null,
      otherRequests.some(r => r.reasoningEffort !== null) ? 'preview settings leaked into another tier' : null,
      turnRequests.some(r => r.error && !/abort/i.test(r.error)) ? 'request error' : null,
    ].filter((p): p is string => p !== null);
    // Choices falling back or escalating is allowed behavior; report it.
    const notes = [
      result.choicesEscalated ? 'choices escalated' : null,
      result.choicesFailed ? 'choices fallback' : null,
      ...diagnostics.filter(d => d.status === 'timeout').map(d => `${d.agent} timeout`),
    ].filter((n): n is string => n !== null);
    if (problems.length > 0) {
      failures++;
    }
    const stateChanges = Object.fromEntries(STATE_FIELDS
      .map(field => [field, (result as unknown as Record<string, unknown>)[field]])
      .filter(([, value]) => value !== null && value !== undefined));

    appendRecord('smoke.jsonl', {
      type: 'turn', runId, fixtureId: fixture.id, durationMs, ok: problems.length === 0, problems, notes,
      narration: result.narration, rollNarration: result.rollNarration ?? null, currentTensionLevel: result.currentTensionLevel,
      choices: result.choices, stateChanges, choicesEscalated: result.choicesEscalated, choicesFailed: result.choicesFailed,
      diagnostics, requests: turnRequests,
    });
    const agents = diagnostics.map(d => `${d.agent}:${d.status}`).join(' ');
    console.log(`[smoke] ${problems.length === 0 ? 'ok  ' : 'FAIL'} ${fixture.id} ${durationMs}ms requests=${turnRequests.length} [${agents}]${notes.length ? ` notes: ${notes.join(', ')}` : ''}${problems.length ? ` problems: ${problems.join('; ')}` : ''}`);
    console.log(`[smoke]      state: ${Object.keys(stateChanges).join(', ') || 'none'}; choices: ${result.choices.map(c => c.label).join(' | ')}`);
  }

  appendRecord('smoke.jsonl', { type: 'summary', runId, finishedAt: new Date().toISOString(), requests: recorder.started(), failures });
  console.log(`[smoke] ${fixtures.length - failures}/${fixtures.length} ok, requests=${recorder.started()}; results appended to data/model-refresh/smoke.jsonl`);
  if (failures > 0) {
    process.exit(2);
  }
}

main().catch((err: unknown) => {
  console.error('[smoke] failed:', err);
  process.exit(1);
});
