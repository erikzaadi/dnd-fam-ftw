import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../../services/gameEngine.js';
import { resolvePartyRecovery } from '../../services/partyRecoveryService.js';
import { acceptSessionOperation } from '../../services/sessionOperationService.js';
import { StateService } from '../../services/stateService.js';
import { executeTurnAction } from '../../services/turnService.js';
import { TURN_STRATEGIES } from './mockNarrationProvider.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

// A whole freeform campaign through the real orchestrator and agents (only the OpenAI SDK
// is mocked): combat, a riddle posed by narration and answered in the player's own words,
// a party wipe with the dragon rescue, and a second wipe with sanctuary. No turn may run
// the choices agent, its retries, or its fallback: suggestions only come from "Give me ideas".

const sdk = vi.hoisted(() => ({
  stream: vi.fn(),
  create: vi.fn(),
  // Schema name of every structured agent request, in order.
  agents: [] as string[],
  // What the narration agent says next (a riddle, for one turn).
  narration: null as Record<string, unknown> | null,
}));

vi.mock('openai', () => ({
  default: vi.fn(function OpenAIMock() {
    return { chat: { completions: { stream: sdk.stream, create: sdk.create } } };
  }),
}));

vi.mock('../../realtime/sessionEvents.js', () => ({
  broadcastUpdate: vi.fn(),
  broadcastSessionChanged: vi.fn(),
}));

const AGENT_OUTPUT: Record<string, () => Record<string, unknown>> = {
  narration_agent_output: () => sdk.narration ?? {
    narration: 'The tunnel shakes, and the story moves on. Pip, what do you try?',
    rollNarration: null,
    currentTensionLevel: 'medium',
    objectiveOutcome: null,
    posesRiddle: false,
    riddle: null,
  },
  choices_agent_output: () => ({
    choices: [{ label: 'Should never be asked for during a turn', difficulty: 'normal', stat: 'might', difficultyValue: 12 }],
  }),
  combat_agent_output: () => ({ suggestedDamage: null, suggestedEncounterStart: null, suggestedEncounterUpdate: null }),
  inventory_agent_output: () => ({ suggestedInventoryAdd: null, suggestedInventoryRemove: null, suggestedInventoryUpdate: null }),
  recovery_agent_output: () => ({ suggestedRevive: null, suggestedHeal: null, suggestedBuffAdd: null, suggestedBuffRemove: null }),
};

const agentOf = (request: { response_format?: { json_schema?: { name?: string } } }): string =>
  request.response_format?.json_schema?.name ?? 'unknown';

let paths: IntegrationTestPaths;

beforeAll(() => {
  paths = setupIntegrationEnvironment('freeform-campaign');
});

beforeEach(() => {
  sdk.agents.length = 0;
  sdk.narration = null;
  sdk.stream.mockReset();
  sdk.stream.mockImplementation((request: Parameters<typeof agentOf>[0]) => {
    const agent = agentOf(request);
    sdk.agents.push(agent);
    const output = AGENT_OUTPUT[agent]?.() ?? {};
    return {
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockResolvedValue({
        choices: [{ finish_reason: 'stop', message: { refusal: null, parsed: output } }],
      }),
    };
  });
  // Side services (riddle answer extraction, summaries) get an empty JSON answer.
  sdk.create.mockReset();
  sdk.create.mockResolvedValue({ choices: [{ message: { content: '{}' } }] });
});

afterEach(() => {
  delete process.env.AI_TURN_STRATEGY;
  vi.restoreAllMocks();
});

afterAll(() => {
  cleanupIntegrationEnvironment(paths);
});

const rollDice = (roll: number) => vi.spyOn(GameEngine, 'rollDice').mockReturnValue({ roll, total: roll + 2 });

const setPipHp = async (sessionId: string, hp: number) => {
  const stored = await StateService.getSession(sessionId);
  if (!stored) {
    throw new Error('session missing');
  }
  stored.party = stored.party.map(c => ({ ...c, hp, status: 'active' as const }));
  await StateService.updateSession(sessionId, stored);
};

// A failed roll at 1 HP wipes the one-hero party; the rescue runs inside the same
// operation, the way the action route runs it.
const wipeAndRecover = async (sessionId: string, requestId: string) => {
  await setPipHp(sessionId, 1);
  const accepted = acceptSessionOperation({ sessionId, namespaceId: 'local', kind: 'action', requestId, payload: {} });
  if (accepted.type !== 'accepted') {
    throw new Error('expected accepted');
  }
  const spy = rollDice(2);
  const result = await executeTurnAction(sessionId, 'local', { action: 'Pip charges the ogre head-on', statUsed: 'might', difficulty: 'hard', difficultyValue: 16 }, { operationId: accepted.operation.id });
  spy.mockRestore();
  if (!result.ok || !result.pendingRecovery) {
    throw new Error(`expected a party wipe, got ${JSON.stringify(result.ok ? result.pendingRecovery : result.body)}`);
  }
  await resolvePartyRecovery({
    sessionId,
    namespaceId: 'local',
    operationId: accepted.operation.id,
    outcome: result.pendingRecovery,
    wipedState: result.body.session,
    revision: result.revision,
  });
  return result.pendingRecovery;
};

describe.each(TURN_STRATEGIES)('freeform campaign through the real orchestrator (%s)', (strategy) => {
  beforeEach(() => {
    process.env.AI_TURN_STRATEGY = strategy;
  });

  it('plays combat, a typed riddle answer, a rescue and sanctuary without generating suggestions', async () => {
    const id = `freeform-campaign-${strategy}`;
    const pip = makeTestSession().party[0];
    await insertSessionState(makeTestSession({
      id,
      party: [pip],
      activeCharacterId: pip.id,
      encounterState: {
        id: 'enc-goblin',
        name: 'Tunnel Goblin',
        status: 'active',
        round: 1,
        enemies: [{ id: 'enemy-goblin', name: 'Goblin', role: 'minion', hp: 1, maxHp: 4, status: 'active' }],
        areas: [],
      },
    }));

    // Combat: a hit on the goblin.
    let spy = rollDice(18);
    const combat = await executeTurnAction(id, 'local', { action: 'Pip swings the lantern at the goblin', statUsed: 'might', difficulty: 'normal', difficultyValue: 12 });
    spy.mockRestore();
    expect(combat.ok).toBe(true);
    expect(combat.ok && combat.diagnostics?.strategy).toBe(strategy);
    expect(sdk.agents).toContain('combat_agent_output');

    // Narration poses a riddle; the answer is typed, not picked from a list.
    sdk.narration = {
      narration: 'A stone face yawns open: "I answer every call but have no mouth. What am I?" Pip, what do you try?',
      rollNarration: null,
      currentTensionLevel: 'medium',
      objectiveOutcome: null,
      posesRiddle: true,
      riddle: { prompt: 'I answer every call but have no mouth. What am I?', canonicalAnswer: 'an echo', aliases: ['echo'] },
    };
    spy = rollDice(12);
    const posed = await executeTurnAction(id, 'local', { action: 'Pip shouts a hello into the dark', statUsed: 'mischief', difficulty: 'normal', difficultyValue: 10 });
    spy.mockRestore();
    expect(posed.ok).toBe(true);
    sdk.narration = null;

    const answered = await executeTurnAction(id, 'local', { action: "It's an echo!", statUsed: 'mischief', difficulty: 'normal', difficultyValue: 12 });
    expect(answered.ok && answered.body.actionAttempt.actionResult).toMatchObject({ success: true, roll: 0 });

    // First wipe: the dragon rescue. Second wipe: sanctuary.
    expect(await wipeAndRecover(id, `wipe-1-${strategy}`)).toBe('intervention');
    expect(await wipeAndRecover(id, `wipe-2-${strategy}`)).toBe('sanctuary');

    const history = await StateService.getTurnHistory(id);
    expect(history.map(turn => turn.turnType ?? 'normal')).toEqual(expect.arrayContaining(['intervention', 'sanctuary']));
    // No turn stored suggestions, and no turn ran the choices agent (or its retry or fallback).
    for (const turn of history) {
      expect(turn.choices).toEqual([]);
      expect(turn.choicesFailed ?? false).toBe(false);
    }
    expect((await StateService.getSession(id))?.lastChoices ?? []).toEqual([]);
    expect(sdk.agents).not.toContain('choices_agent_output');
    expect(sdk.agents.filter(agent => agent === 'narration_agent_output').length).toBeGreaterThanOrEqual(history.length);
  });
});
