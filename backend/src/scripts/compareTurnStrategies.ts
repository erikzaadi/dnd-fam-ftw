/**
 * Plan 4 comparison: parallel (production) vs resolved_first turn strategies.
 * next-up-instructions/family-first-04-ai-flow.md
 *
 * Makes PAID provider requests unless --provider mock. Never run from unit tests.
 * Run from backend/ (retries must be 0 so every physical request is counted):
 *
 *   # free: check the harness and output format with the mock provider
 *   npx tsx src/scripts/compareTurnStrategies.ts --label smoke --provider mock
 *   # plan only, no calls
 *   npx tsx --env-file=../.env src/scripts/compareTurnStrategies.ts --label first --dry-run
 *   # live (verify current pricing first and pass it explicitly)
 *   OPENAI_MAX_RETRIES=0 npx tsx --env-file=../.env src/scripts/compareTurnStrategies.ts \
 *     --label first --cost-per-request 0.004
 *
 * Options:
 *   --label <name>              Run label (required)
 *   --provider live|mock        live = OpenAI via the real orchestrator (default); mock = MockNarrationProvider
 *   --scenarios <id,id>         Restrict scenarios (default: all 8)
 *   --actions <n>               Player actions per trajectory (default 6)
 *   --max-requests <n>          Physical request ceiling across the whole run (default 600)
 *   --max-cost <usd>            Estimated spend ceiling (default 10)
 *   --cost-per-request <usd>    Required for live runs: estimated cost of one text request
 *   --out-dir <path>            Results directory (default backend/data/strategy-comparison)
 *   --dry-run                   Print the plan and worst-case request count, make no calls
 *
 * Each scenario runs as two independent trajectories (one per strategy) from the same
 * starting fixture and the same scripted player actions, interleaved turn by turn.
 * Trajectories branch naturally, so compare continuity and outcomes, not identical prose.
 * Images, speech and summaries are never generated (side effects are not queued).
 * The run stops at either cap and reports itself as incomplete; a truncated batch
 * cannot pass the release gate.
 *
 * Outputs (per run directory):
 *   turns.jsonl      one record per committed turn: strategy, timings, agents, repairs,
 *                    resolved facts (resolved_first), narration, choices, state diffs
 *   scorecard.csv    blinded rows (A/B) for human scoring of actor correctness, invented
 *                    possessions, resolved-enemy references, matching consequences,
 *                    continuity, clarity and closure
 *   blind-key.json   which strategy is A/B per scenario (open only after scoring)
 *   summary.json     per-strategy totals: p50/p95 end-to-end, first narration, fallbacks,
 *                    repairs, requests, estimated cost
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Character, SessionState, Stat } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.join(__dirname, '..', '..', 'data', 'strategy-comparison');
const STRATEGIES = ['parallel', 'resolved_first'] as const;
type Strategy = typeof STRATEGIES[number];
// Worst case per turn: narration + choices + retry + combat + inventory + recovery
// (+ one schema retry each for the mechanics agents) + encounter-name repair.
const WORST_CASE_REQUESTS_PER_TURN = 10;

type Args = {
  label: string;
  provider: 'live' | 'mock';
  scenarios: string[] | null;
  actions: number;
  maxRequests: number;
  maxCost: number;
  costPerRequest: number | null;
  outDir: string;
  dryRun: boolean;
};

const parseArgs = (argv: string[]): Args => {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const label = get('--label');
  if (!label) {
    throw new Error('--label is required');
  }
  const provider = (get('--provider') ?? 'live') as Args['provider'];
  if (provider !== 'live' && provider !== 'mock') {
    throw new Error('--provider must be live or mock');
  }
  return {
    label,
    provider,
    scenarios: get('--scenarios')?.split(',').map(s => s.trim()).filter(Boolean) ?? null,
    actions: Number(get('--actions') ?? 6),
    maxRequests: Number(get('--max-requests') ?? 600),
    maxCost: Number(get('--max-cost') ?? 10),
    costPerRequest: get('--cost-per-request') !== undefined ? Number(get('--cost-per-request')) : null,
    outDir: get('--out-dir') ?? DEFAULT_OUT_DIR,
    dryRun: argv.includes('--dry-run'),
  };
};

// ── Scenarios ──────────────────────────────────────────────────────────────────

type ScriptedAction = { action: string; statUsed: Stat | 'none'; itemId?: string; actionType?: 'use_item' };
type Scenario = {
  id: string;
  covers: string;
  build: (id: string) => SessionState;
  actions: ScriptedAction[];
};

const hero = (id: string, name: string, cls: string, stats: Character['stats'], hp = 10, extra: Partial<Character> = {}): Character => ({
  id, name, class: cls, species: 'Human', quirk: 'Talks to birds', hp, max_hp: 10, status: 'active', stats, inventory: [], ...extra,
});

const baseSession = (id: string, overrides: Partial<SessionState> = {}): SessionState => ({
  id,
  scene: 'The Clockwork Market',
  sceneId: `${id}-scene`,
  worldDescription: 'A bustling market of wind-up stalls and gossiping lanterns',
  turn: 3,
  party: [
    hero(`${id}-pip`, 'Pip', 'Rogue', { might: 1, magic: 2, mischief: 5 }),
    hero(`${id}-zara`, 'Zara', 'Wizard', { might: 1, magic: 5, mischief: 2 }),
    hero(`${id}-brom`, 'Brom', 'Fighter', { might: 5, magic: 1, mischief: 1 }),
  ],
  activeCharacterId: `${id}-pip`,
  npcs: [],
  quests: [],
  lastChoices: [],
  tone: 'playful adventure',
  recentHistory: ['The party arrived at the market just as the clocks began to run backwards.'],
  displayName: 'Strategy Comparison',
  difficulty: 'normal',
  gameMode: 'balanced',
  savingsMode: true,
  interventionState: { rescuesUsed: 0 },
  storySummary: 'STORY SO FAR: The party is chasing a thief who stole the market\'s Winding Key.\nNEXT PROMISED BEAT: Find where the thief hid the key.',
  ...overrides,
});

const ENCOUNTER = (id: string): SessionState['encounterState'] => ({
  id: `${id}-enc`,
  name: 'Gear Goblin Ambush',
  status: 'active',
  round: 1,
  objective: 'Stop the Gear Goblins',
  areas: [{ id: `${id}-area`, label: 'Spinning cog floor', description: 'Gears turn underfoot', tags: ['moving'] }],
  enemies: [
    { id: `${id}-g1`, name: 'Gear Goblin', role: 'standard', hp: 4, maxHp: 6, status: 'active', traits: ['sticky fingers'] },
  ],
});

const SCENARIOS: Scenario[] = [
  {
    id: 'guided-explore',
    covers: 'noncombat exploration, suggested-style actions',
    build: id => baseSession(id),
    actions: [
      { action: 'Search the clock stalls for the thief\'s trail', statUsed: 'mischief' },
      { action: 'Ask the gossiping lanterns what they saw', statUsed: 'magic' },
      { action: 'Push through the crowd toward the tower', statUsed: 'might' },
      { action: 'Read the backwards clocks for a hidden message', statUsed: 'magic' },
      { action: 'Sneak past the guard at the tower door', statUsed: 'mischief' },
      { action: 'Force the rusted tower door open', statUsed: 'might' },
    ],
  },
  {
    id: 'freeform-creative',
    covers: 'creative free text (Freeform-style input)',
    build: id => baseSession(id),
    actions: [
      { action: 'Pip swings from the lantern strings to spot the thief from above', statUsed: 'mischief' },
      { action: 'Zara makes every clock chime at once to startle the thief', statUsed: 'magic' },
      { action: 'Brom offers the thief a fair trade: the key for a hot pie', statUsed: 'mischief' },
      { action: 'Pip juggles three pocket watches to distract the guard', statUsed: 'mischief' },
      { action: 'Zara whispers to the tower\'s gears to open the way', statUsed: 'magic' },
      { action: 'Brom lifts the fallen market cart to free a trapped vendor', statUsed: 'might' },
    ],
  },
  {
    id: 'combat-resolution',
    covers: 'active encounter through resolution and loot',
    build: id => baseSession(id, { encounterState: ENCOUNTER(id), scene: 'The Cog Pit' }),
    actions: [
      { action: 'Strike the Gear Goblin with a quick dagger jab', statUsed: 'mischief' },
      { action: 'Blast the Gear Goblin with a spark of lightning', statUsed: 'magic' },
      { action: 'Smash the Gear Goblin with a heavy hammer blow', statUsed: 'might' },
      { action: 'Search the goblin\'s pockets for the Winding Key', statUsed: 'mischief' },
      { action: 'Follow the goblin\'s tracks out of the pit', statUsed: 'magic' },
      { action: 'Climb out of the cog pit', statUsed: 'might' },
    ],
  },
  {
    id: 'item-use',
    covers: 'item use turn plus follow-up actions',
    build: id => {
      const session = baseSession(id);
      session.party[0] = { ...session.party[0], hp: 4, inventory: [{ id: `${id}-potion`, name: 'Healing Potion', description: 'Restores 3 HP', healValue: 3, consumable: true, transferable: true }] };
      return session;
    },
    actions: [
      { action: 'use item', statUsed: 'none', itemId: 'potion', actionType: 'use_item' },
      { action: 'Search the potion stall for more supplies', statUsed: 'mischief' },
      { action: 'Haggle with the potion seller', statUsed: 'mischief' },
      { action: 'Test the strange bubbling vial', statUsed: 'magic' },
      { action: 'Guard the stall from pickpockets', statUsed: 'might' },
      { action: 'Chase the pickpocket into the alley', statUsed: 'might' },
    ],
  },
  {
    id: 'recovery',
    covers: 'downed ally, healing and support actions',
    build: id => {
      const session = baseSession(id, { encounterState: ENCOUNTER(id), scene: 'The Cog Pit' });
      session.party[2] = { ...session.party[2], hp: 0, status: 'downed' };
      return session;
    },
    actions: [
      { action: 'Heal Brom with a burst of warm light', statUsed: 'magic' },
      { action: 'Shield Brom from the Gear Goblin', statUsed: 'might' },
      { action: 'Distract the Gear Goblin with a shiny coin', statUsed: 'mischief' },
      { action: 'Bless Pip with a lucky charm', statUsed: 'magic' },
      { action: 'Strike the Gear Goblin', statUsed: 'mischief' },
      { action: 'Help Brom back to his feet', statUsed: 'might' },
    ],
  },
  {
    id: 'one-evening-finale',
    covers: 'one-evening decisive finale and conclusion',
    build: id => baseSession(id, {
      adventure: {
        format: 'one_evening', status: 'active', chapter: 1, phase: 'finale', playerActionCount: 9, budgetStartCount: 0,
        finaleStartedAtCount: 8, participatingHeroIds: [`${id}-pip`, `${id}-zara`, `${id}-brom`], wrapUpRequested: false,
        decisiveAttempts: 0, objective: 'Recover the Winding Key before the market clocks stop forever.',
      },
      scene: 'The top of the clock tower',
    }),
    actions: [
      { action: 'Snatch the Winding Key from the thief', statUsed: 'mischief' },
      { action: 'Freeze the tower gears with a spell', statUsed: 'magic' },
      { action: 'Wrestle the thief away from the edge', statUsed: 'might' },
      { action: 'Wind the great clock with the key', statUsed: 'magic' },
      { action: 'Talk the thief into giving up', statUsed: 'mischief' },
      { action: 'Hold the tower door shut', statUsed: 'might' },
    ],
  },
  {
    id: 'long-lived',
    covers: 'long-lived continuation (no ending pressure)',
    build: id => baseSession(id, {
      adventure: {
        format: 'long_lived', status: 'active', chapter: 2, phase: 'development', playerActionCount: 30, budgetStartCount: 0,
        participatingHeroIds: [], wrapUpRequested: false, decisiveAttempts: 0,
      },
    }),
    actions: [
      { action: 'Visit the old clockmaker for rumors', statUsed: 'mischief' },
      { action: 'Study the clockmaker\'s strange blueprint', statUsed: 'magic' },
      { action: 'Carry the heavy blueprint crate', statUsed: 'might' },
      { action: 'Follow the blueprint to the sewer gate', statUsed: 'mischief' },
      { action: 'Unlock the sewer gate with a spell', statUsed: 'magic' },
      { action: 'Wade into the sewer tunnels', statUsed: 'might' },
    ],
  },
  {
    id: 'dm-prep',
    covers: 'DM Prep premise and secrets in context',
    build: id => baseSession(id, {
      dmPrep: 'PREMISE: The Winding Key keeps time itself running in the market. VILLAIN: Madame Tock, a clockmaker who wants to stop time so her shop never closes. SECRETS: The thief works for Madame Tock; the lanterns are her spies.',
      compiledDmPrep: 'The Winding Key keeps market time running. Madame Tock wants to stop time forever; the thief and the lanterns secretly serve her.',
    }),
    actions: [
      { action: 'Question the lanterns about who they report to', statUsed: 'magic' },
      { action: 'Follow a lantern to its secret meeting', statUsed: 'mischief' },
      { action: 'Break into Madame Tock\'s workshop', statUsed: 'might' },
      { action: 'Read Madame Tock\'s diary', statUsed: 'magic' },
      { action: 'Set a trap for the thief with a fake key', statUsed: 'mischief' },
      { action: 'Confront the thief in the workshop', statUsed: 'might' },
    ],
  },
];

// ── Run ────────────────────────────────────────────────────────────────────────

type TurnRecord = Record<string, unknown> & { strategy: Strategy; scenario: string; turnIndex: number; totalMs: number; requests: number };

const percentile = (values: number[], p: number): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

const csvCell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = SCENARIOS.filter(s => !args.scenarios || args.scenarios.includes(s.id));
  const turns = scenarios.length * Math.min(args.actions, 6) * STRATEGIES.length;
  const worstCase = turns * WORST_CASE_REQUESTS_PER_TURN;
  console.log(`[Compare] label=${args.label} provider=${args.provider} scenarios=${scenarios.map(s => s.id).join(',')}`);
  console.log(`[Compare] ${turns} turn executions (${scenarios.length} scenarios x ${Math.min(args.actions, 6)} actions x ${STRATEGIES.length} strategies)`);
  console.log(`[Compare] worst case ${worstCase} requests; caps: ${args.maxRequests} requests, $${args.maxCost}`);
  if (args.dryRun) {
    for (const scenario of scenarios) {
      console.log(`  - ${scenario.id}: ${scenario.covers}`);
    }
    return;
  }
  if (args.provider === 'live') {
    if (args.costPerRequest === null || !(args.costPerRequest > 0)) {
      throw new Error('Live runs need --cost-per-request <usd> (verify current pricing first).');
    }
    if (process.env.OPENAI_MAX_RETRIES !== '0') {
      throw new Error('Export OPENAI_MAX_RETRIES=0 before starting, so every physical request is counted.');
    }
  } else {
    process.env.TEST_AI_MOCK = 'true';
  }

  // Isolated database and storage for this run.
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${args.label}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-strategy-compare-'));
  process.env.SQLITE_DB_PATH = path.join(tmp, 'compare.sqlite');
  process.env.LOCAL_IMAGE_STORAGE_PATH = path.join(tmp, 'images');
  process.env.IMAGE_STORAGE_PROVIDER = 'local';

  const { StateService } = await import('../services/stateService.js');
  const { executeTurnAction } = await import('../services/turnService.js');
  const { insertSessionState } = await import('../tests/integration/testSessionFixtures.js');
  const { sessionRepository } = await import('../repositories/sessionRepository.js');
  StateService.initialize();

  const outDir = path.join(args.outDir, runId);
  fs.mkdirSync(outDir, { recursive: true });
  const turnsFile = fs.createWriteStream(path.join(outDir, 'turns.jsonl'));
  const records: TurnRecord[] = [];
  const blindKey: Record<string, Record<'A' | 'B', Strategy>> = {};
  let requests = 0;
  let stopReason: string | null = null;
  const estimatedCost = () => requests * (args.costPerRequest ?? 0);

  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    // Alternate which strategy goes first so provider warm-up does not favor one.
    const order: Strategy[] = scenarioIndex % 2 === 0 ? ['parallel', 'resolved_first'] : ['resolved_first', 'parallel'];
    blindKey[scenario.id] = scenarioIndex % 3 === 0 ? { A: 'parallel', B: 'resolved_first' } : { A: 'resolved_first', B: 'parallel' };
    const sessionIds: Record<Strategy, string> = { parallel: `${scenario.id}-parallel`, resolved_first: `${scenario.id}-resolved` };
    for (const strategy of STRATEGIES) {
      const fixture = scenario.build(sessionIds[strategy]);
      await insertSessionState(fixture);
      // insertSessionState covers the core row; lifecycle and compiled prep need their own writers.
      if (fixture.adventure) {
        sessionRepository.writeAdventureSync(fixture.id, fixture.adventure);
        if (fixture.adventure.objective) {
          sessionRepository.setAdventureObjectiveIfMissing(fixture.id, fixture.adventure.objective, null);
        }
      }
      if (fixture.compiledDmPrep) {
        await StateService.patchSession(fixture.id, { compiledDmPrep: fixture.compiledDmPrep });
      }
    }
    const ended: Record<Strategy, boolean> = { parallel: false, resolved_first: false };

    for (let turnIndex = 0; turnIndex < Math.min(args.actions, scenario.actions.length); turnIndex++) {
      for (const strategy of order) {
        if (ended[strategy]) {
          continue;
        }
        if (requests + WORST_CASE_REQUESTS_PER_TURN > args.maxRequests) {
          stopReason = `request cap ${args.maxRequests}`;
        } else if (args.provider === 'live' && estimatedCost() + WORST_CASE_REQUESTS_PER_TURN * (args.costPerRequest ?? 0) > args.maxCost) {
          stopReason = `cost cap $${args.maxCost}`;
        }
        if (stopReason) {
          break;
        }
        const sessionId = sessionIds[strategy];
        const scripted = scenario.actions[turnIndex];
        const before = await StateService.getSession(sessionId);
        if (!before || before.gameOver || before.adventure?.status !== undefined && before.adventure.status !== 'active') {
          // Ended trajectories stop: record early completion instead of padding turns.
          ended[strategy] = true;
          continue;
        }
        process.env.AI_TURN_STRATEGY = strategy;
        const request = scripted.itemId
          // Fixtures name items `<sessionId>-<itemId>` so each trajectory uses its own copy.
          ? { action: scripted.action, statUsed: scripted.statUsed, actionType: scripted.actionType, itemId: `${sessionId}-${scripted.itemId}` }
          : { action: scripted.action, statUsed: scripted.statUsed };
        const start = Date.now();
        const result = await executeTurnAction(sessionId, 'local', request);
        const totalMs = Date.now() - start;
        if (!result.ok) {
          const record: TurnRecord = { strategy, scenario: scenario.id, turnIndex, totalMs, requests: 0, rejected: result.body };
          records.push(record);
          turnsFile.write(`${JSON.stringify(record)}\n`);
          ended[strategy] = true;
          continue;
        }
        const turn = result.body.turnResult;
        const agentCount = turn.agentDiagnostics?.length ?? 0;
        requests += args.provider === 'live' ? agentCount : 0;
        const record: TurnRecord = {
          strategy,
          scenario: scenario.id,
          turnIndex,
          action: scripted.action,
          totalMs,
          firstNarrationMs: result.diagnostics?.firstNarrationMs ?? null,
          requests: agentCount,
          stages: result.diagnostics?.stages ?? [],
          repairs: result.diagnostics?.repairs ?? [],
          agents: (turn.agentDiagnostics ?? []).map(a => ({ agent: a.agent, status: a.status, durationMs: a.durationMs })),
          narrationFailed: turn.narrationFailed ?? false,
          choicesFailed: turn.choicesFailed ?? false,
          roll: turn.lastAction?.actionResult ?? null,
          narration: turn.narration,
          choices: turn.choices.map(c => c.label),
          hpChanges: turn.hpChanges ?? [],
          inventoryChanges: turn.inventoryChanges ?? [],
          encounterEnemyChanges: turn.encounterEnemyChanges ?? [],
          encounter: result.body.session.encounterState ? { name: result.body.session.encounterState.name, status: result.body.session.encounterState.status } : null,
          adventure: result.body.session.adventure ? { phase: result.body.session.adventure.phase, status: result.body.session.adventure.status } : null,
          pendingConclusion: result.pendingConclusion ?? null,
          pendingRecovery: result.pendingRecovery ?? null,
        };
        records.push(record);
        turnsFile.write(`${JSON.stringify(record)}\n`);
        if (result.pendingConclusion || result.pendingRecovery) {
          // The follow-up (ending or rescue) is outside this comparison; stop the trajectory.
          ended[strategy] = true;
        }
        console.log(`[Compare] ${scenario.id} #${turnIndex + 1} ${strategy} ${totalMs}ms requests=${agentCount} repairs=${record.repairs}`);
      }
      if (stopReason) {
        break;
      }
    }
    if (stopReason) {
      break;
    }
  }
  turnsFile.end();

  // Blinded scorecard: reviewers see A/B, never strategy names.
  const scoreHeader = ['scenario', 'turn', 'variant', 'action', 'roll_success', 'mechanical_changes', 'narration', 'choices',
    'actor_correct(0-2)', 'invented_possessions(count)', 'resolved_enemy_refs(count)', 'consequences_match(0-2)', 'continuity(0-2)', 'clarity_for_kids(0-2)', 'closure(0-2|na)', 'notes'];
  const rows = records.filter(r => r.narration !== undefined).map(r => {
    const variant = blindKey[r.scenario].A === r.strategy ? 'A' : 'B';
    const changes = JSON.stringify({ hp: r.hpChanges, items: r.inventoryChanges, enemies: r.encounterEnemyChanges });
    return [r.scenario, r.turnIndex + 1, variant, r.action, (r.roll as { success?: boolean } | null)?.success ?? 'no roll', changes, r.narration, (r.choices as string[]).join(' | '), '', '', '', '', '', '', '', ''].map(csvCell).join(',');
  });
  fs.writeFileSync(path.join(outDir, 'scorecard.csv'), [scoreHeader.map(csvCell).join(','), ...rows].join('\n'));
  fs.writeFileSync(path.join(outDir, 'blind-key.json'), JSON.stringify(blindKey, null, 2));

  const summary = Object.fromEntries(STRATEGIES.map(strategy => {
    const ok = records.filter(r => r.strategy === strategy && r.narration !== undefined);
    const totals = ok.map(r => r.totalMs);
    const firsts = ok.map(r => r.firstNarrationMs as number | null).filter((v): v is number => typeof v === 'number');
    return [strategy, {
      turns: ok.length,
      rejected: records.filter(r => r.strategy === strategy && r.narration === undefined).length,
      p50TotalMs: percentile(totals, 50),
      p95TotalMs: percentile(totals, 95),
      p50FirstNarrationMs: percentile(firsts, 50),
      p95FirstNarrationMs: percentile(firsts, 95),
      narrationFallbacks: ok.filter(r => r.narrationFailed).length,
      choicesFallbacks: ok.filter(r => r.choicesFailed).length,
      repairs: ok.flatMap(r => r.repairs as string[]).reduce<Record<string, number>>((acc, name) => ({ ...acc, [name]: (acc[name] ?? 0) + 1 }), {}),
      requests: ok.reduce((sum, r) => sum + r.requests, 0),
    }];
  }));
  const report = {
    runId,
    provider: args.provider,
    complete: !stopReason,
    stopReason,
    requests,
    estimatedCostUsd: args.provider === 'live' ? Number(estimatedCost().toFixed(4)) : 0,
    strategies: summary,
    note: 'Q gates: compare p95 total (<= comparator +20%) and p95 first narration (<= comparator +2s); count contradictions from the scorecard, including streamed text. An incomplete run cannot pass the release gate.',
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(report, null, 2));
  console.log(`[Compare] ${report.complete ? 'complete' : `STOPPED (${stopReason})`} requests=${requests} estimatedCost=$${report.estimatedCostUsd}`);
  console.log(`[Compare] results: ${outDir}`);
  fs.rmSync(tmp, { recursive: true, force: true });
};

main().catch(err => {
  console.error('[Compare] failed:', err);
  process.exit(1);
});
