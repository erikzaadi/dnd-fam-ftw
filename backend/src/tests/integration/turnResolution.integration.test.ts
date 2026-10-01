import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NarrationStreamCallbacks } from '../../providers/ai/narration/NarrationProvider.js';
import { GameEngine } from '../../services/gameEngine.js';
import { StateService } from '../../services/stateService.js';
import { executeTurnAction } from '../../services/turnService.js';
import type { SessionState } from '../../types.js';
import {
  FIXED_NARRATION_OUTPUT,
  TURN_STRATEGIES,
  expectTurnStrategy,
  mockGenerateTurn,
  mockNarrateResolved,
  mockProposeMechanics,
  pinTurnStrategy,
  scriptTurnOutput,
} from './mockNarrationProvider.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

// Characterization for the turn resolution extraction (architecture-deepening plan 1).
// These pin what both strategies do today between "the attempt is known" and "the
// turn is committed", so the extraction can prove it changed nothing.

const mocks = vi.hoisted(() => ({
  broadcastUpdate: vi.fn(),
  broadcastSessionChanged: vi.fn(),
  nameRepairCreate: vi.fn(),
}));

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createStagedMockNarrationProvider } = await import('./mockNarrationProvider.js');
  return {
    createNarrationProvider: vi.fn(() => createStagedMockNarrationProvider()),
    // Encounter-name repair is the only turn step that asks this client.
    createChatClientForTier: vi.fn(() => ({
      model: 'test-preview',
      client: { chat: { completions: { create: mocks.nameRepairCreate } } },
    })),
  };
});

vi.mock('../../realtime/sessionEvents.js', () => ({
  broadcastUpdate: mocks.broadcastUpdate,
  broadcastSessionChanged: mocks.broadcastSessionChanged,
}));

let paths: IntegrationTestPaths;

beforeAll(() => {
  paths = setupIntegrationEnvironment('turn-resolution');
});

beforeEach(() => {
  scriptTurnOutput();
  mocks.broadcastUpdate.mockReset();
  mocks.broadcastSessionChanged.mockReset();
  mocks.nameRepairCreate.mockReset();
  mocks.nameRepairCreate.mockResolvedValue({ choices: [{ message: { content: 'Soot Gremlin' } }] });
});

afterEach(() => {
  delete process.env.AI_TURN_STRATEGY;
  vi.restoreAllMocks();
});

afterAll(() => {
  cleanupIntegrationEnvironment(paths);
});

const broadcastsOf = (event: string) => mocks.broadcastUpdate.mock.calls.filter(call => call[1] === event);

type HpChange = { characterId: string; change: number; newHp: number };
const pipHpChange = (changes: HpChange[] | undefined): HpChange | undefined => changes?.find(change => change.characterId === 'char-pip');

describe.each(TURN_STRATEGIES)('turn resolution characterization (%s)', (strategy) => {
  beforeEach(() => {
    process.env.AI_TURN_STRATEGY = strategy;
  });

  // No operationId: committing with one requires an accepted operation (see the
  // operations suite for the ledger). The events' operationId is then undefined.
  it('streams narration chunks and aborts', async () => {
    const id = `tr-stream-${strategy}`;
    await insertSessionState(makeTestSession({ id }));
    const stream = async (callbacks: NarrationStreamCallbacks | undefined) => {
      callbacks?.onChunk('The goblin', 'narration');
      callbacks?.onAbort();
    };
    if (strategy === 'parallel') {
      mockGenerateTurn.mockImplementationOnce(async (...args: unknown[]) => {
        await stream(args[1] as NarrationStreamCallbacks | undefined);
        return FIXED_NARRATION_OUTPUT;
      });
    } else {
      mockNarrateResolved.mockImplementationOnce(async (_input, callbacks) => {
        await stream(callbacks);
        return { narration: FIXED_NARRATION_OUTPUT.narration, currentTensionLevel: 'medium', choices: [], objectiveOutcome: null };
      });
    }

    const result = await executeTurnAction(id, 'local', { action: 'Pip juggles three apples', statUsed: 'mischief' });

    expectTurnStrategy(result, strategy);
    expect(broadcastsOf('narration_chunk')[0]?.[2]).toMatchObject({ text: 'The goblin', field: 'narration' });
    expect(broadcastsOf('narration_chunk_abort')).toHaveLength(1);
  });

  it('sends an early HP preview that matches the final change when the AI proposes no damage', async () => {
    const id = `tr-preview-deterministic-${strategy}`;
    await insertSessionState(makeTestSession({ id }));
    vi.spyOn(GameEngine, 'rollDice').mockReturnValue({ roll: 3, total: 5 });

    const result = await executeTurnAction(id, 'local', { action: 'Pip kicks the stuck barrel', statUsed: 'might', difficulty: 'normal', difficultyValue: 15 });

    expectTurnStrategy(result, strategy);
    if (!result.ok) {
      return;
    }
    const preview = broadcastsOf('narration_roll_ready')[0]?.[2] as { hpChanges?: HpChange[] } | undefined;
    const previewChange = pipHpChange(preview?.hpChanges);
    expect(previewChange).toBeDefined();
    expect(pipHpChange(result.body.turnResult.hpChanges as HpChange[] | undefined)).toEqual(previewChange);
  });

  it('keeps the early HP preview deterministic when the AI proposes its own damage', async () => {
    const id = `tr-preview-ai-damage-${strategy}`;
    await insertSessionState(makeTestSession({ id }));
    vi.spyOn(GameEngine, 'rollDice').mockReturnValue({ roll: 3, total: 5 });
    scriptTurnOutput({ ...FIXED_NARRATION_OUTPUT, suggestedDamage: 1 });

    const result = await executeTurnAction(id, 'local', { action: 'Pip kicks the stuck barrel', statUsed: 'might', difficulty: 'normal', difficultyValue: 15 });

    expectTurnStrategy(result, strategy);
    if (!result.ok) {
      return;
    }
    const preview = broadcastsOf('narration_roll_ready')[0]?.[2] as { hpChanges?: HpChange[] } | undefined;
    // Today the preview is computed before generation and never sees the AI's number
    // (it uses the difficulty table, at least 2 on a normal action); the committed turn
    // applies the AI's damage instead.
    expect(pipHpChange(preview?.hpChanges)?.change).toBeLessThan(-1);
    expect(pipHpChange(result.body.turnResult.hpChanges as HpChange[] | undefined)).toMatchObject({ change: -1, newHp: 7 });
  });

  it('propagates a provider 429 instead of committing a fallback turn', async () => {
    const id = `tr-429-${strategy}`;
    await insertSessionState(makeTestSession({ id }));
    const rateLimited = Object.assign(new Error('slow down'), { status: 429 });
    if (strategy === 'parallel') {
      mockGenerateTurn.mockRejectedValueOnce(rateLimited);
    } else {
      mockProposeMechanics.mockRejectedValueOnce(rateLimited);
    }

    await expect(executeTurnAction(id, 'local', { action: 'Pip juggles three apples', statUsed: 'mischief' })).rejects.toMatchObject({ status: 429 });
    expect(await StateService.getTurnHistory(id)).toHaveLength(0);
  });

  it('repairs a low-quality encounter name through the preview client', async () => {
    const id = `tr-name-repair-${strategy}`;
    await insertSessionState(makeTestSession({
      id,
      encounterState: {
        id: 'enc-threat',
        name: 'Goblin Threat',
        status: 'active',
        round: 1,
        enemies: [{ id: 'enemy-threat', name: 'Goblin Threat', role: 'standard', hp: 6, maxHp: 6, status: 'active' }],
        areas: [],
      },
    }));
    vi.spyOn(GameEngine, 'rollDice').mockReturnValue({ roll: 3, total: 5 });

    const result = await executeTurnAction(id, 'local', { action: 'Pip hides behind a barrel', statUsed: 'mischief', difficulty: 'normal', difficultyValue: 15 });

    expectTurnStrategy(result, strategy);
    expect(mocks.nameRepairCreate).toHaveBeenCalled();
    const stored = await StateService.getSession(id);
    expect(stored?.encounterState?.name).toBe('Soot Gremlin');
    expect(stored?.encounterState?.enemies[0].name).toBe('Soot Gremlin');
  });
});

describe('turn resolution characterization (parallel only)', () => {
  pinTurnStrategy('parallel');

  it('commits a fallback turn flagged as failed when the provider throws', async () => {
    const id = 'tr-parallel-provider-error';
    await insertSessionState(makeTestSession({ id }));
    mockGenerateTurn.mockRejectedValueOnce(new Error('provider down'));

    const result = await executeTurnAction(id, 'local', { action: 'Pip juggles three apples', statUsed: 'mischief' });

    expectTurnStrategy(result, 'parallel');
    if (!result.ok) {
      return;
    }
    expect(result.body.turnResult.narrationFailed).toBe(true);
    expect(result.body.turnResult.choices).toEqual([]);
    const history = await StateService.getTurnHistory(id);
    expect(history).toHaveLength(1);
    expect(history[0].narrationFailed).toBe(true);
    expect(history[0].narrationValidationError).toBe('provider down');
  });
});

describe('turn resolution characterization (resolved_first only)', () => {
  pinTurnStrategy('resolved_first');

  it('commits the presentation failure flag from narrateResolved', async () => {
    const id = 'tr-rf-narration-failed';
    await insertSessionState(makeTestSession({ id }));
    mockNarrateResolved.mockResolvedValueOnce({
      narration: 'Pip juggles; the apples land safely.',
      currentTensionLevel: 'low',
      choices: [],
      objectiveOutcome: null,
      narrationFailed: true,
    });

    const result = await executeTurnAction(id, 'local', { action: 'Pip juggles three apples', statUsed: 'mischief' });

    expectTurnStrategy(result, 'resolved_first');
    if (!result.ok) {
      return;
    }
    expect(result.body.turnResult.narrationFailed).toBe(true);
    expect((await StateService.getTurnHistory(id))[0].narrationFailed).toBe(true);
  });

  it('fails the turn without a fallback when presentation throws', async () => {
    const id = 'tr-rf-presentation-throws';
    await insertSessionState(makeTestSession({ id }));
    mockNarrateResolved.mockRejectedValueOnce(new Error('provider down'));

    await expect(executeTurnAction(id, 'local', { action: 'Pip juggles three apples', statUsed: 'mischief' })).rejects.toThrow('provider down');
    expect(await StateService.getTurnHistory(id)).toHaveLength(0);
  });

  it('strips choices that still target an enemy the frozen mechanics defeated', async () => {
    const id = 'tr-rf-strip-defeated';
    const encounterSession: Partial<SessionState> = {
      id,
      encounterState: {
        id: 'enc-ambusher',
        name: 'Ambusher Skirmish',
        status: 'active',
        round: 1,
        enemies: [{ id: 'enemy-ambusher', name: 'Ambusher', role: 'standard', hp: 1, maxHp: 6, status: 'active' }],
        areas: [],
      },
    };
    await insertSessionState(makeTestSession(encounterSession));
    vi.spyOn(GameEngine, 'rollDice').mockReturnValue({ roll: 15, total: 20 });
    mockNarrateResolved.mockResolvedValueOnce({
      narration: 'Pip lands the blow.',
      currentTensionLevel: 'medium',
      choices: [
        { label: 'Finish off the Ambusher', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
        { label: 'Search the kitchen', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
      ],
      objectiveOutcome: null,
    });

    const result = await executeTurnAction(id, 'local', { action: 'Pip strikes the Ambusher with a precise blade thrust', statUsed: 'magic', difficulty: 'easy', difficultyValue: 1 });

    expectTurnStrategy(result, 'resolved_first');
    if (!result.ok) {
      return;
    }
    expect(result.body.turnResult.choices.map(choice => choice.label).join(' ').toLowerCase()).not.toContain('ambusher');
    expect(result.diagnostics?.repairs).toContain('strip_defeated_enemy_choices');
  });
});
