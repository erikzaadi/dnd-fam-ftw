/**
 * Paid compatibility probe for moving the narration and async tiers off the
 * retiring gpt-4.1 / gpt-4.1-mini (OpenAI shutdown 2027-01-14). Sends every
 * narration- and async-tier request shape through its production code path
 * with both tiers set to --model and reasoning_effort --effort (default none):
 *
 *   - one deliberate raw request with max_tokens, to record whether the model
 *     still accepts it (the application no longer sends it)
 *   - three full turns through DmTurnOrchestrator: streamed narration and
 *     choices structured output, plus the combat, inventory and recovery
 *     agents those fixtures trigger
 *   - TLDR, hero history and epilogue (narration tier, non-streamed)
 *   - the DM prep image brief (async tier, the tightest summary token cap)
 *
 * Checks request compatibility and empty/truncated replies, not quality.
 * No images or speech. Run from backend/:
 *
 *   OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/probeTierCompatibility.ts [--model gpt-6-luna] [--effort none] [--dry-run]
 *
 * About 17 requests (ceiling 30). Results are appended to
 * data/model-refresh/tier-probe.jsonl.
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
import type { SessionState, TurnResult } from '../types.js';

const MAX_REQUESTS = 30;
// Exploration, active combat, and a downed ally: narration, choices, and all
// three mechanics agents.
const TURN_FIXTURE_IDS = ['explore-corridor', 'combat-active-bridge', 'heal-downed-ally'];
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'omit'];

const SESSION = {
  id: 'tier-probe',
  displayName: 'The Rune Vault',
  scene: 'The vault door',
  party: [
    { id: 'pip', name: 'Pip', class: 'Rogue', species: 'Halfling', quirk: 'Hums while sneaking', hp: 8, max_hp: 10, status: 'active', stats: { might: 1, magic: 2, mischief: 5 }, inventory: [] },
    { id: 'zara', name: 'Zara', class: 'Wizard', species: 'Elf', quirk: 'Collects buttons', hp: 10, max_hp: 10, status: 'active', stats: { might: 1, magic: 5, mischief: 2 }, inventory: [] },
  ],
  adventure: { participatingHeroIds: ['pip', 'zara'], objective: 'Recover the stolen crown from the rune vault.' },
} as unknown as SessionState;

const HISTORY = [
  { characterId: 'pip', narration: 'Pip slipped past the sleeping warden and found the vault door.', lastAction: { actionAttempt: 'Sneak past the warden', actionResult: { statUsed: 'mischief', success: true } } },
  { characterId: 'zara', narration: 'Zara traced the glowing runes until the lock sighed open.', lastAction: { actionAttempt: 'Unravel the rune lock', actionResult: { statUsed: 'magic', success: true } } },
  { characterId: 'pip', narration: 'Pip lifted the crown from its cushion and the vault began to rumble.', lastAction: { actionAttempt: 'Grab the crown', actionResult: { statUsed: 'mischief', success: true } } },
] as unknown as TurnResult[];

function parseEffort(argv: string[]): string {
  const index = argv.indexOf('--effort');
  if (index === -1) {
    return 'none';
  }
  const effort = argv[index + 1];
  if (!effort || !EFFORTS.includes(effort)) {
    console.error(`--effort requires one of: ${EFFORTS.join(', ')}`);
    process.exit(1);
  }
  return effort;
}

type CaseResult = { name: string; problems: string[]; notes: string[]; output: unknown; requests: RecordedRequest[] };

async function main() {
  const argv = process.argv.slice(2);
  const model = parseModelArg(argv, 'gpt-6-luna');
  const effort = parseEffort(argv);
  const dryRun = argv.includes('--dry-run');
  process.env.OPENAI_MODEL_NARRATION = model;
  process.env.OPENAI_MODEL_ASYNC = model;
  process.env.OPENAI_REASONING_EFFORT_NARRATION = effort;
  process.env.OPENAI_REASONING_EFFORT_ASYNC = effort;
  const expectedEffort = effort === 'omit' ? null : effort;

  const fixtures = TURN_FIXTURE_IDS.map(id => {
    const fixture = MODEL_REFRESH_CHOICES_FIXTURES.find(f => f.id === id);
    if (!fixture) {
      throw new Error(`Unknown fixture id "${id}"`);
    }
    return fixture;
  });
  console.log(`[tier-probe] narration+async model=${model} reasoning=${effort} turns=${fixtures.length} ceiling=${MAX_REQUESTS}`);
  if (dryRun) {
    console.log(`[tier-probe] cases: max_tokens acceptance, turns (${TURN_FIXTURE_IDS.join(', ')}), TLDR, hero history, epilogue, DM prep image brief`);
    console.log('[tier-probe] dry run: no provider calls made');
    return;
  }
  preflight('tier-probe');

  const { createOpenAIClient } = await import('../providers/ai/openAiClient.js');
  const { DmTurnOrchestrator } = await import('../services/dmTurnOrchestrator.js');
  const { summarizeAdventure, summarizeHeroHistory, ADVENTURE_SUMMARY_FALLBACK } = await import('../services/playerSummaryService.js');
  const { generateEpilogueText } = await import('../services/adventureConclusionService.js');
  const { StorySummaryService } = await import('../services/storySummaryService.js');

  const runId = `tier-probe-${model}-${effort}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  appendRecord('tier-probe.jsonl', {
    type: 'run', runId, startedAt: new Date().toISOString(), git: gitRevision(),
    model, reasoningEffort: effort, maxRetries: 0, fixtureVersion: MODEL_REFRESH_FIXTURE_VERSION, fixtures: TURN_FIXTURE_IDS,
  });

  let currentLabel = '';
  let caseRequests: RecordedRequest[] = [];
  const recorder = installRequestRecorder({
    maxRequests: MAX_REQUESTS,
    getLabel: () => currentLabel,
    onRequest: (request) => caseRequests.push(request),
  });

  // Requests the application sends to the probed model must carry the probed
  // settings and never the removed fields.
  const requestProblems = (requests: RecordedRequest[]): string[] => {
    const tierRequests = requests.filter(r => r.model === model);
    return [
      tierRequests.length === 0 ? 'no request to the probed model' : null,
      tierRequests.some(r => r.reasoningEffort !== expectedEffort) ? 'unexpected reasoning_effort' : null,
      tierRequests.some(r => r.maxTokens !== null || r.maxCompletionTokens === null) ? 'max_tokens sent or max_completion_tokens missing' : null,
      tierRequests.some(r => r.hasTemperature) ? 'temperature sent' : null,
      tierRequests.some(r => !r.stream && r.finishReason === 'length' && !r.content?.trim()) ? 'empty reply truncated by the token cap' : null,
      requests.some(r => r.error && !/abort/i.test(r.error)) ? `request error: ${requests.find(r => r.error)?.error ?? ''}` : null,
    ].filter((p): p is string => p !== null);
  };

  const results: CaseResult[] = [];
  const runCase = async (name: string, run: () => Promise<{ output: unknown; problems?: string[]; notes?: string[] }>) => {
    currentLabel = name;
    caseRequests = [];
    let outcome: { output: unknown; problems?: string[]; notes?: string[] };
    try {
      outcome = await run();
    } catch (err) {
      outcome = { output: null, problems: [`threw: ${err instanceof Error ? err.message : String(err)}`] };
    }
    // Deadline-aborted streams may report shortly after the call resolves.
    await new Promise(resolve => setTimeout(resolve, 500));
    const result: CaseResult = {
      name,
      problems: [...(outcome.problems ?? []), ...(name === 'max_tokens acceptance' ? [] : requestProblems(caseRequests))],
      notes: outcome.notes ?? [],
      output: outcome.output,
      requests: caseRequests,
    };
    results.push(result);
    appendRecord('tier-probe.jsonl', { type: 'case', runId, ...result });
    const timing = caseRequests.map(r => `${r.durationMs}ms`).join(' ');
    console.log(`[tier-probe] ${result.problems.length === 0 ? 'ok  ' : 'FAIL'} ${name} requests=${caseRequests.length} [${timing}]${result.notes.length ? ` notes: ${result.notes.join(', ')}` : ''}${result.problems.length ? ` problems: ${result.problems.join('; ')}` : ''}`);
  };

  // Informational only: the application never sends max_tokens any more.
  await runCase('max_tokens acceptance', async () => {
    try {
      await createOpenAIClient().chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        max_tokens: 20,
        ...(expectedEffort ? { reasoning_effort: expectedEffort as 'none' } : {}),
      }, { signal: AbortSignal.timeout(20_000) });
      return { output: 'accepted', notes: ['max_tokens accepted'] };
    } catch (err) {
      return { output: 'rejected', notes: [`max_tokens rejected: ${err instanceof Error ? err.message : String(err)}`] };
    }
  });

  const orchestrator = new DmTurnOrchestrator();
  for (const fixture of fixtures) {
    await runCase(`turn ${fixture.id}`, async () => {
      const result = await orchestrator.orchestrate(fixture.build());
      const diagnostics = result.agentDiagnostics;
      const narrationDiag = diagnostics.find(d => d.agent === 'narration');
      return {
        output: { narration: result.narration, rollNarration: result.rollNarration ?? null, choices: result.choices.map(c => c.label), diagnostics },
        problems: [
          !result.narration?.trim() ? 'empty narration' : null,
          narrationDiag?.status !== 'ok' ? `narration ${narrationDiag?.status ?? 'missing'}` : null,
          ...diagnostics.filter(d => d.errorKind && d.errorKind !== 'timeout').map(d => `${d.agent} ${d.errorKind}: ${d.errorMessage ?? ''}`),
        ].filter((p): p is string => p !== null),
        notes: [
          `agents ${diagnostics.map(d => `${d.agent}:${d.status}`).join(' ')}`,
          result.choicesEscalated ? 'choices escalated' : null,
          result.choicesFailed ? 'choices fallback' : null,
          ...diagnostics.filter(d => d.status === 'timeout').map(d => `${d.agent} timeout`),
        ].filter((n): n is string => n !== null),
      };
    });
  }

  await runCase('TLDR', async () => {
    const text = await summarizeAdventure(SESSION, HISTORY);
    return { output: text, problems: text === ADVENTURE_SUMMARY_FALLBACK || !text.trim() ? ['fallback or empty summary'] : [] };
  });

  await runCase('hero history', async () => {
    const text = await summarizeHeroHistory(HISTORY, 'The Rune Vault');
    return { output: text, problems: !text?.trim() ? ['empty hero history'] : [] };
  });

  await runCase('epilogue', async () => {
    const { text, failed } = await generateEpilogueText(SESSION, HISTORY, 'success');
    return { output: text, problems: failed ? ['deterministic epilogue fallback'] : [] };
  });

  await runCase('DM prep image brief (async)', async () => {
    const brief = await StorySummaryService.generateDmPrepImageBrief('PREMISE: A stolen crown lies in a rune vault. VILLAIN: The vault warden, a stone giant who hunts thieves. SECRETS: The crown is cursed and whispers to whoever wears it.');
    return { output: brief, problems: !brief ? ['empty brief'] : [] };
  });

  const failures = results.filter(r => r.problems.length > 0).length;
  appendRecord('tier-probe.jsonl', { type: 'summary', runId, finishedAt: new Date().toISOString(), requests: recorder.started(), failures });
  console.log(`[tier-probe] ${results.length - failures}/${results.length} ok, requests=${recorder.started()}; results appended to data/model-refresh/tier-probe.jsonl`);
  if (failures > 0) {
    console.log('[tier-probe] BLOCKED: investigate the failing cases before evaluating this configuration.');
    process.exit(2);
  }
}

main().catch((err: unknown) => {
  console.error('[tier-probe] failed:', err);
  process.exit(1);
});
