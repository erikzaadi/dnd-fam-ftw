/**
 * Paid helper smoke check for the model refresh
 * (next-up-instructions/model-refresh-02-live-validation.md, "Give helpers a
 * lighter pass"). Calls every preview-tier helper through its production
 * function with three or more inputs, including Unicode names and contextual
 * inputs, and checks for non-empty valid output with zero parameter errors or
 * truncations. Exercises the 10/20/24 caps explicitly. Run from backend/:
 *
 *   OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/checkPreviewHelpers.ts [--model gpt-5.6-luna] [--dry-run]
 *
 * The preview model is set to --model with reasoning_effort "none" for the
 * whole run. Makes one request per case (22 cases, ceiling 30). Uses a
 * temporary SQLite database for the two session-backed helpers; no image or
 * speech generation. Results are appended to data/model-refresh/helpers.jsonl.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Request, Response } from 'express';
import {
  appendRecord,
  gitRevision,
  installRequestRecorder,
  parseModelArg,
  preflight,
  type RecordedRequest,
} from './modelRefreshRecorder.js';
import type { Character, EncounterState, SessionState } from '../types.js';

const MAX_REQUESTS = 30;
const SESSION_ID = 'model-refresh-helper-check';

type Case = {
  shape: string;
  cap: number;
  run: () => Promise<unknown>;
  // Shape-specific validity check on the function result and raw content.
  valid: (result: unknown, content: string) => string | null;
};

const hero = (overrides: Partial<Character> & Pick<Character, 'id' | 'name' | 'class' | 'species'>): Character => ({
  quirk: 'Hums while thinking',
  hp: 10,
  max_hp: 10,
  status: 'active',
  stats: { might: 2, magic: 2, mischief: 3 },
  inventory: [],
  ...overrides,
} as Character);

const soren = hero({ id: 'char-soren', name: 'Søren Ælfwine', class: 'Ranger', species: 'Human', stats: { might: 4, magic: 2, mischief: 3 } });
const yuki = hero({ id: 'char-yuki', name: '雪 Yuki', class: 'Bard', species: 'Gnome', hp: 5, max_hp: 9, stats: { might: 1, magic: 3, mischief: 4 } });

const goblinEnemies: EncounterState['enemies'] = [
  {
    id: 'gob-1', name: 'Snag the Goblin Boss', role: 'boss', hp: 9, maxHp: 14, status: 'active',
    weaknesses: [{ id: 'w-1', label: 'Afraid of bright light', school: 'light', revealed: true }],
  },
  { id: 'gob-2', name: 'Goblin Slinger', role: 'minion', hp: 3, maxHp: 4, status: 'active' },
];

const repairEncounter = (name: string, enemyName: string, objective: string, traits: string[]): EncounterState => ({
  id: `enc-${name.toLowerCase().replace(/\W+/g, '-')}`,
  name,
  status: 'active',
  round: 1,
  objective,
  areas: [],
  enemies: [{ id: 'enemy-1', name: enemyName, role: 'boss', hp: 12, maxHp: 12, status: 'active', traits }],
});

const nonEmptyString = (result: unknown) => (typeof result === 'string' && result.trim() ? null : 'empty result');
const isJson = (content: string) => {
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
};

async function main() {
  const argv = process.argv.slice(2);
  const model = parseModelArg(argv, 'gpt-5.6-luna');
  const dryRun = argv.includes('--dry-run');

  process.env.OPENAI_MODEL_PREVIEW = model;
  process.env.OPENAI_REASONING_EFFORT_PREVIEW = 'none';
  const tmpBase = path.join(os.tmpdir(), `dnd-helper-check-${process.pid}-${Date.now()}`);
  process.env.SQLITE_DB_PATH = `${tmpBase}.sqlite`;
  process.env.LOCAL_IMAGE_STORAGE_PATH = `${tmpBase}-images`;
  process.env.IMAGE_STORAGE_PROVIDER = 'local';

  // Imported after the env above: config and the database are lazily bound.
  const { StateService } = await import('../services/stateService.js');
  const { insertSessionState, makeTestSession } = await import('../tests/integration/testSessionFixtures.js');
  const { generateSessionDisplayName } = await import('../services/sessionNameService.js');
  const { suggestStatForSessionAction, previewFreeAction, buildEncounterContextFromEnemies } = await import('../services/statSuggestionService.js');
  const { createStatSuggestionRouter } = await import('../routes/statSuggestionRoutes.js');
  const { generateImageBrief } = await import('../providers/ai/images/imageBriefProvider.js');
  const { compileDmPrepPremise } = await import('../services/dmPrepCompilationService.js');
  const { repairEncounterNameIfNeeded } = await import('../services/encounterNameRepairService.js');
  const { isLowQualityEncounterName } = await import('../services/encounterService.js');

  const session = (): SessionState => makeTestSession({
    id: SESSION_ID,
    scene: 'A frosty harbor market where gulls steal from the fish stalls',
    worldDescription: 'A snowy harbor town hiding a stolen dragon egg',
    party: [soren, yuki],
    activeCharacterId: soren.id,
    recentHistory: ['雪 Yuki sang to the harbor master, who winked and pointed at the lighthouse.'],
  });

  const suggestStats = async (body: Record<string, string>) => {
    const router = createStatSuggestionRouter() as unknown as {
      stack: Array<{ route?: { path: string; stack: Array<{ handle: (req: Request, res: Response, next: (err?: unknown) => void) => unknown }> } }>;
    };
    const layer = router.stack.find(l => l.route?.path === '/character/suggest-stats');
    let payload: unknown = null;
    const res = { json: (value: unknown) => {
      payload = value; 
    }, status: () => res } as unknown as Response;
    await layer?.route?.stack[0].handle({ body } as Request, res, () => undefined);
    return payload;
  };

  const repairName = async (encounter: EncounterState, narration: string) => {
    const state = session();
    const newState: SessionState = { ...session(), encounterState: encounter, dmPrepEncounters: [] };
    await repairEncounterNameIfNeeded(state, newState, { narration, actionAttempt: 'Charge the foe' });
    return newState.encounterState?.name ?? null;
  };
  const repairValid = (badName: string) => (result: unknown, content: string) => {
    if (typeof result !== 'string' || result === badName || isLowQualityEncounterName(result)) {
      return `name not repaired (${String(result)})`;
    }
    return content.toLowerCase().includes(result.split(' ')[0].toLowerCase()) ? null : `model name rejected; deterministic fallback "${result}" used`;
  };

  const encounterContext = buildEncounterContextFromEnemies(goblinEnemies);
  const statWord = (_result: unknown, content: string) =>
    /\b(might|magic|mischief)\b/i.test(content) ? null : `no stat word in "${content}"`;
  const previewJson = (_result: unknown, content: string) => (isJson(content) ? null : 'content is not JSON');

  const cases: Case[] = [
    // Session display name (20-token cap)
    ...['A frosty birch forest where the trees whisper in riddles',
      'The harbor town where 雪 Yuki and Søren Ælfwine hunt a stolen dragon egg',
      'A cozy bakery kingdom ruled by a very grumpy muffin'].map((world): Case => ({
      shape: 'session-name', cap: 20,
      run: () => generateSessionDisplayName(world),
      valid: (result) => (result === 'A New Realm' ? 'fallback name returned' : null),
    })),
    // Session action stat suggestion (10-token cap)
    ...['Loose an arrow at the rope holding the cargo net',
      'Convince the harbor master to share his secret',
      'Call on the northern stars to reveal the hidden egg'].map((action): Case => ({
      shape: 'stat-suggestion', cap: 10,
      run: () => suggestStatForSessionAction(SESSION_ID, { action }),
      valid: statWord,
    })),
    // Free action preview: all four cap variants (80/160/120/220)
    {
      shape: 'free-action-preview', cap: 80,
      run: () => previewFreeAction(SESSION_ID, { action: 'Søren climbs the lighthouse to scan the harbor' }),
      valid: previewJson,
    },
    {
      shape: 'free-action-preview', cap: 160,
      run: () => previewFreeAction(SESSION_ID, { action: 'Flash a lantern in the goblin boss\'s eyes', encounterContext }),
      valid: previewJson,
    },
    {
      shape: 'free-action-preview', cap: 120,
      run: () => previewFreeAction(SESSION_ID, { context: { intent: 'aid_character', targetCharacterId: yuki.id } }),
      valid: previewJson,
    },
    {
      shape: 'free-action-preview', cap: 220,
      run: () => previewFreeAction(SESSION_ID, { context: { intent: 'party_boost' }, encounterContext }),
      valid: previewJson,
    },
    // Character creation stat suggestion route (60-token cap)
    ...[{ name: 'Søren Ælfwine', class: 'Ranger', species: 'Human', quirk: 'Talks to hawks' },
      { name: '雪 Yuki', class: 'Bard', species: 'Gnome', quirk: 'Rhymes everything' },
      { name: 'Grumbletoe', class: 'Paladin', species: 'Dwarf', quirk: 'Afraid of ducks' }].map((body): Case => ({
      shape: 'character-stats', cap: 60,
      run: () => suggestStats(body),
      valid: (_result, content) => (isJson(content) ? null : 'content is not JSON'),
    })),
    // Image brief (60-token cap)
    ...[
      ['A rope bridge over a misty gorge', 'Søren Ælfwine', 'Søren draws his bow as the goblin boss swings at the ropes.'],
      ['A frosty harbor market', '雪 Yuki', 'Yuki sings to a flock of gulls, who drop a glittering key at her feet.'],
      ['A glowing forest shrine', 'Mira Warmheal', 'Warm light washes over the party as Mira kneels at the mossy altar.'],
    ].map(([scene, actor, narration]): Case => ({
      shape: 'image-brief', cap: 60,
      run: () => generateImageBrief(narration, scene, actor, 'medium'),
      valid: (result) => nonEmptyString(result),
    })),
    // DM prep compilation (200-token cap)
    ...[
      'A stolen dragon egg is hidden somewhere in the harbor town of Saltmere. The harbor master, Old Quill, knows more than he says. The smugglers of the Grey Gull guild want to sell the egg before the mother dragon returns at the next full moon.',
      'Søren Ælfwine\'s home village of Ælfheim is sinking into the frozen marsh. The witch 雪 Hana claims the marsh spirits are angry, but the mayor is secretly draining the marsh for silver. The party must choose between the spirits and the village treasury.',
      'The Clockwork Carnival arrives in Breadcrumb Town every hundred years. This time its ringmaster, Madame Tock, is collecting laughter in glass jars. Children who lose their laugh fall into a deep sleep, and only the Mirror Maze holds the key.',
    ].map((prep): Case => ({
      shape: 'dm-prep', cap: 200,
      run: () => compileDmPrepPremise(prep),
      valid: (result) => nonEmptyString(result),
    })),
    // Encounter name repair (24-token cap)
    ...[
      ['Fierce Radiant Foe', 'Fierce Foe', 'Stop the frost wolf from stealing the fish', ['frost', 'pack hunter']],
      ['Powerful Threat', 'Powerful Threat', 'Drive the clockwork crab off the pier', ['mechanical', 'snapping claws']],
      ['Ambush As The', 'Ambush As The', 'Escape the marsh spirit guarding Søren\'s village', ['spectral', 'bog light']],
    ].map(([name, enemy, objective, traits]): Case => ({
      shape: 'encounter-name-repair', cap: 24,
      run: () => repairName(repairEncounter(name as string, enemy as string, objective as string, traits as string[]), `The party faces the ${objective as string}.`),
      valid: repairValid(name as string),
    })),
  ];

  console.log(`[helpers] model=${model} reasoning=none cases=${cases.length} ceiling=${MAX_REQUESTS}`);
  if (dryRun) {
    for (const c of cases) {
      console.log(`[helpers] ${c.shape} cap=${c.cap}`);
    }
    console.log('[helpers] dry run: no provider calls made');
    return;
  }
  preflight('helpers');

  StateService.initialize();
  await insertSessionState(session());

  const runId = `helpers-${model}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  appendRecord('helpers.jsonl', { type: 'run', runId, startedAt: new Date().toISOString(), git: gitRevision(), model, reasoningEffort: 'none', maxRetries: 0, cases: cases.length });

  let currentLabel = '';
  let caseRequests: RecordedRequest[] = [];
  const recorder = installRequestRecorder({
    maxRequests: MAX_REQUESTS,
    getLabel: () => currentLabel,
    onRequest: (request) => caseRequests.push(request),
  });

  let failures = 0;
  for (const [index, c] of cases.entries()) {
    currentLabel = `${c.shape}#${index + 1}`;
    caseRequests = [];
    const result = await c.run();
    const request = caseRequests[0];
    const content = request?.content?.trim() ?? '';
    const problems = [
      caseRequests.length !== 1 ? `expected 1 request, saw ${caseRequests.length}` : null,
      request?.error ? `request error: ${request.error}` : null,
      request && request.finishReason !== 'stop' ? `finish_reason=${String(request.finishReason)}` : null,
      request && !content ? 'empty content' : null,
      request && request.maxCompletionTokens !== c.cap ? `max_completion_tokens=${String(request.maxCompletionTokens)}, expected ${c.cap}` : null,
      request && (request.maxTokens !== null || request.hasTemperature || request.reasoningEffort !== 'none') ? 'unexpected request settings' : null,
      request && !request.error && content ? c.valid(result, content) : null,
    ].filter((p): p is string => p !== null);
    if (problems.length > 0) {
      failures++;
    }
    const usage = request?.usage as { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } | null;
    appendRecord('helpers.jsonl', {
      type: 'case', runId, label: currentLabel, shape: c.shape, cap: c.cap,
      ok: problems.length === 0, problems, result, request,
    });
    const tokens = usage?.completion_tokens ?? '?';
    const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    console.log(`[helpers] ${problems.length === 0 ? 'ok  ' : 'FAIL'} ${currentLabel} cap=${c.cap} tokens=${tokens} reasoning=${reasoning} ${request?.durationMs ?? '-'}ms :: ${problems.join('; ') || (typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 110)}`);
  }

  appendRecord('helpers.jsonl', { type: 'summary', runId, finishedAt: new Date().toISOString(), requests: recorder.started(), failures });
  console.log(`[helpers] ${cases.length - failures}/${cases.length} ok, requests=${recorder.started()}; results appended to data/model-refresh/helpers.jsonl`);

  for (const file of [process.env.SQLITE_DB_PATH, `${process.env.SQLITE_DB_PATH}-wal`, `${process.env.SQLITE_DB_PATH}-shm`]) {
    fs.rmSync(file as string, { force: true });
  }
  fs.rmSync(process.env.LOCAL_IMAGE_STORAGE_PATH as string, { recursive: true, force: true });
  if (failures > 0) {
    process.exit(2);
  }
}

main().catch((err: unknown) => {
  console.error('[helpers] failed:', err);
  process.exit(1);
});
