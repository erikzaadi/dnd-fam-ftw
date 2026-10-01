import { describe, expect, it, vi } from 'vitest';
import type { MechanicsProposal, NarrationProvider, NarrationStreamCallbacks, ResolvedPresentation } from '../providers/ai/narration/NarrationProvider.js';
import { FIXED_NARRATION_OUTPUT } from '../tests/integration/mockNarrationProvider.js';
import type { ActionAttempt, AIInput, SessionState } from '../types.js';
import { decideTurn } from './freeActionPolicyService.js';
import { createTurnDiagnostics } from './turnDiagnostics.js';
import { resolveTurn, type TurnResolutionParams } from './turnResolution.js';

// resolveTurn through its interface: an in-memory session and injected fakes, no
// database and no provider factory.

const makeSession = (): SessionState => ({
  id: 'resolution-session',
  scene: 'A goblin kitchen',
  sceneId: 'kitchen-1',
  worldDescription: 'A playful dungeon',
  turn: 3,
  party: [{
    id: 'char-pip',
    name: 'Pip',
    class: 'Bard',
    species: 'Halfling',
    quirk: 'Hums constantly',
    hp: 8,
    max_hp: 10,
    status: 'active',
    stats: { might: 1, magic: 3, mischief: 3 },
    inventory: [],
  }],
  activeCharacterId: 'char-pip',
  npcs: [],
  quests: [],
  lastChoices: [],
  tone: 'thrilling adventure',
  recentHistory: [],
  displayName: 'Resolution Realm',
  difficulty: 'normal',
  savingsMode: true,
  interventionState: { rescuesUsed: 0 },
  storySummary: '',
});

// A failed healing song that the AI wants to punish with 2 damage. The free-action
// policies zero that damage (healing never hurts the healer); item turns skip them.
const failedHealing: ActionAttempt = {
  actionAttempt: 'Pip sings a healing song',
  actionResult: { success: false, roll: 3, statUsed: 'magic', difficulty: 'normal', impact: 'normal', difficultyTarget: 15 },
};

const noMechanics: MechanicsProposal = {
  suggestedDamage: null,
  suggestedEncounterStart: null,
  suggestedEncounterUpdate: null,
  suggestedInventoryAdd: null,
  suggestedInventoryRemove: null,
  suggestedInventoryUpdate: null,
  suggestedRevive: null,
  suggestedHeal: null,
  suggestedBuffAdd: null,
  suggestedBuffRemove: null,
};

const presentation: ResolvedPresentation = {
  narration: 'The song falters.',
  currentTensionLevel: 'medium',
  choices: [],
  objectiveOutcome: null,
};

const makeProvider = (staged: boolean) => {
  const generateTurn = vi.fn<NarrationProvider['generateTurn']>(async () => ({ ...FIXED_NARRATION_OUTPUT, suggestedDamage: 2 }));
  const proposeMechanics = vi.fn<NonNullable<NarrationProvider['proposeMechanics']>>(async () => ({ ...noMechanics, suggestedDamage: 2 }));
  const narrateResolved = vi.fn<NonNullable<NarrationProvider['narrateResolved']>>(async () => presentation);
  const provider: NarrationProvider = staged ? { generateTurn, proposeMechanics, narrateResolved } : { generateTurn };
  return { provider, generateTurn, proposeMechanics, narrateResolved };
};

const makeParams = (overrides: {
  strategy: 'resolved_first' | 'parallel';
  kind?: 'rolled' | 'item';
  staged?: boolean;
  stream?: NarrationStreamCallbacks;
}) => {
  const session = makeSession();
  const fakes = makeProvider(overrides.staged ?? true);
  const nameRepair = vi.fn<TurnResolutionParams['deps']['nameRepair']>(async () => undefined);
  const diagnostics = createTurnDiagnostics(overrides.strategy);
  const aiInput: AIInput = { ...session, ...failedHealing, characterId: 'char-pip' };
  const params: TurnResolutionParams = {
    kind: overrides.kind ?? 'rolled',
    session,
    attempt: failedHealing,
    actingCharId: 'char-pip',
    aiInput,
    decision: decideTurn(failedHealing.actionAttempt, undefined, undefined),
    deps: { narration: fakes.provider, nameRepair },
    ...(overrides.stream && { stream: overrides.stream }),
    diagnostics,
  };
  return { params, fakes, nameRepair, diagnostics };
};

describe.each(['resolved_first', 'parallel'] as const)('resolveTurn policies (%s)', (strategy) => {
  it('applies the free-action policies to rolled turns', async () => {
    const { params, diagnostics } = makeParams({ strategy });

    const { newState } = await resolveTurn(params);

    expect(newState.party[0].hp).toBe(8);
    expect(diagnostics.record.repairs).toContain('suppress_failed_support_damage');
  });

  it('skips the free-action policies on item turns', async () => {
    const { params, diagnostics } = makeParams({ strategy, kind: 'item' });

    const { newState } = await resolveTurn(params);

    expect(newState.party[0].hp).toBe(6);
    expect(diagnostics.record.repairs).not.toContain('suppress_failed_support_damage');
  });

  it('leaves the input session untouched', async () => {
    const { params } = makeParams({ strategy });
    const before = structuredClone(params.session);

    await resolveTurn(params);

    expect(params.session).toEqual(before);
  });
});

describe('resolveTurn (resolved_first)', () => {
  it('proposes mechanics, freezes them, then narrates from the facts', async () => {
    const stream: NarrationStreamCallbacks = { onChunk: vi.fn(), onStreamingDone: vi.fn(), onAbort: vi.fn() };
    const { params, fakes, nameRepair, diagnostics } = makeParams({ strategy: 'resolved_first', stream });

    const result = await resolveTurn(params);

    expect(result.strategyUsed).toBe('resolved_first');
    expect(fakes.generateTurn).not.toHaveBeenCalled();
    expect(fakes.proposeMechanics.mock.invocationCallOrder[0]).toBeLessThan(fakes.narrateResolved.mock.invocationCallOrder[0]);
    expect(fakes.narrateResolved.mock.calls[0][0].resolvedTurn).toBe(result.facts);
    expect(fakes.narrateResolved.mock.calls[0][1]).toBe(stream);
    expect(nameRepair).toHaveBeenCalledWith(params.session, result.newState, { narration: null, actionAttempt: failedHealing.actionAttempt });
    expect(result.turnResult.narration).toBe('The song falters.');
    expect(result.newState.lastChoices).toBe(result.turnResult.choices);
    expect(diagnostics.record.stages.map(stage => stage.stage)).toEqual(['mechanics', 'resolve', 'presentation']);
  });

  it('falls back to parallel when the provider has no staged methods', async () => {
    const { params, fakes, diagnostics } = makeParams({ strategy: 'resolved_first', staged: false });

    const result = await resolveTurn(params);

    expect(result.strategyUsed).toBe('parallel');
    expect(result.facts).toBeUndefined();
    expect(diagnostics.record.strategy).toBe('parallel');
    expect(fakes.generateTurn).toHaveBeenCalledTimes(1);
  });
});

describe('resolveTurn (parallel)', () => {
  it('generates once, applies, and repairs the encounter name with the narration', async () => {
    const stream: NarrationStreamCallbacks = { onChunk: vi.fn(), onStreamingDone: vi.fn(), onAbort: vi.fn() };
    const { params, fakes, nameRepair, diagnostics } = makeParams({ strategy: 'parallel', stream });

    const result = await resolveTurn(params);

    expect(result.strategyUsed).toBe('parallel');
    expect(result.facts).toBeUndefined();
    expect(fakes.generateTurn).toHaveBeenCalledTimes(1);
    expect(fakes.generateTurn.mock.calls[0][1]).toBe(stream);
    expect(fakes.proposeMechanics).not.toHaveBeenCalled();
    expect(nameRepair).toHaveBeenCalledWith(params.session, result.newState, { narration: FIXED_NARRATION_OUTPUT.narration, actionAttempt: failedHealing.actionAttempt });
    expect(diagnostics.record.stages.map(stage => stage.stage)).toEqual(['generation']);
  });

  it('rethrows a provider 429', async () => {
    const { params, fakes } = makeParams({ strategy: 'parallel' });
    fakes.generateTurn.mockRejectedValueOnce(Object.assign(new Error('slow down'), { status: 429 }));

    await expect(resolveTurn(params)).rejects.toMatchObject({ status: 429 });
  });
});
