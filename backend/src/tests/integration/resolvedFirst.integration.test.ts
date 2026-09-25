import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../../services/gameEngine.js';
import { StateService } from '../../services/stateService.js';
import { executeTurnAction } from '../../services/turnService.js';
import {
  mockGenerateTurn,
  mockNarrateResolved,
  mockProposeMechanics,
  resetMockNarrationProvider,
  resetStagedMockNarrationProvider,
} from './mockNarrationProvider.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createStagedMockNarrationProvider } = await import('./mockNarrationProvider.js');
  return {
    createNarrationProvider: vi.fn(() => createStagedMockNarrationProvider()),
    createChatClientForTier: vi.fn(),
  };
});

let paths: IntegrationTestPaths;

beforeAll(() => {
  paths = setupIntegrationEnvironment('resolved-first');
});

beforeEach(() => {
  resetMockNarrationProvider();
  resetStagedMockNarrationProvider();
  process.env.AI_TURN_STRATEGY = 'resolved_first';
  vi.spyOn(GameEngine, 'rollDice').mockReturnValue({ roll: 15, total: 19 });
});

afterEach(() => {
  delete process.env.AI_TURN_STRATEGY;
  vi.restoreAllMocks();
});

afterAll(() => {
  cleanupIntegrationEnvironment(paths);
});

describe('resolved_first strategy (plan 4 candidate)', () => {
  it('freezes mechanics before narration and narrates from the resolved facts', async () => {
    await insertSessionState(makeTestSession({ id: 'rf-loot' }));
    mockProposeMechanics.mockResolvedValueOnce({
      suggestedDamage: null,
      suggestedEncounterStart: null,
      suggestedEncounterUpdate: null,
      suggestedInventoryAdd: { name: 'Silver Ladle', description: 'Shiny', statBonuses: {} },
      suggestedInventoryRemove: null,
      suggestedInventoryUpdate: null,
      suggestedRevive: null,
      suggestedHeal: null,
      suggestedBuffAdd: null,
      suggestedBuffRemove: null,
    });

    const result = await executeTurnAction('rf-loot', 'local', { action: 'Search the pantry', statUsed: 'mischief' });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // Order: mechanics first, presentation second, no parallel monolith call.
    expect(mockProposeMechanics).toHaveBeenCalledTimes(1);
    expect(mockNarrateResolved).toHaveBeenCalledTimes(1);
    expect(mockGenerateTurn).not.toHaveBeenCalled();
    expect(mockProposeMechanics.mock.invocationCallOrder[0]).toBeLessThan(mockNarrateResolved.mock.invocationCallOrder[0]);

    // Narration saw the frozen outcome: the loot fact and the post-turn inventory.
    const presentationInput = mockNarrateResolved.mock.calls[0][0];
    expect(presentationInput.resolvedTurn?.facts.join(' ')).toContain('gained the item "Silver Ladle"');
    expect(presentationInput.inventory.map(item => item.name)).toContain('Silver Ladle');

    // The committed state is exactly the frozen one.
    const stored = await StateService.getSession('rf-loot');
    expect(stored?.party.find(c => c.id === 'char-pip')?.inventory.map(i => i.name)).toEqual(['Silver Ladle']);
    expect(result.body.turnResult.inventoryChanges).toEqual([{ characterName: 'Pip', itemName: 'Silver Ladle', type: 'added' }]);
    expect(result.diagnostics).toMatchObject({ strategy: 'resolved_first' });
    expect(result.diagnostics?.stages.map(s => s.stage)).toEqual(['mechanics', 'resolve', 'presentation']);
  });

  it('never starts a fight from narration prose; only a combat proposal can', async () => {
    await insertSessionState(makeTestSession({ id: 'rf-no-prose-fight' }));
    mockNarrateResolved.mockResolvedValueOnce({
      narration: 'A goblin chef bursts out of the pantry, swinging a ladle!',
      currentTensionLevel: 'high',
      choices: [],
      objectiveOutcome: null,
    });

    const result = await executeTurnAction('rf-no-prose-fight', 'local', { action: 'Open the pantry', statUsed: 'might' });
    expect(result.ok).toBe(true);
    expect((await StateService.getSession('rf-no-prose-fight'))?.encounterState).toBeUndefined();
  });

  it('falls back to the parallel comparator when the provider has no staged methods', async () => {
    const factory = await import('../../providers/ai/AiProviderFactory.js');
    const { createMockNarrationProvider } = await import('./mockNarrationProvider.js');
    // Once: the resolved-first check gets a provider without staged methods. A lasting
    // mockImplementation would leak into later tests (restoreAllMocks does not reset vi.fn).
    vi.mocked(factory.createNarrationProvider).mockImplementationOnce(() => createMockNarrationProvider());
    await insertSessionState(makeTestSession({ id: 'rf-fallback' }));

    const result = await executeTurnAction('rf-fallback', 'local', { action: 'Hum a tune', statUsed: 'magic' });
    expect(result.ok).toBe(true);
    expect(mockGenerateTurn).toHaveBeenCalledTimes(1);
    expect(mockProposeMechanics).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.diagnostics?.strategy).toBe('parallel');
    }
  });

  it('records a riddle posed by the resolved-facts narration, with choices matching its answer', async () => {
    await insertSessionState(makeTestSession({ id: 'rf-riddle' }));
    mockNarrateResolved.mockResolvedValueOnce({
      narration: 'A stone face asks: "What has a neck but no head?"',
      currentTensionLevel: 'medium',
      choices: [
        { label: 'Answer: a shirt', difficulty: 'normal', stat: 'magic', difficultyValue: 12, riddleAnswer: 'a shirt', riddleCorrect: true },
        { label: 'Answer: a bottle', difficulty: 'normal', stat: 'magic', difficultyValue: 12, riddleAnswer: 'a bottle', riddleCorrect: false },
        { label: 'Study the carvings', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
      ],
      objectiveOutcome: null,
      narratedRiddle: { canonicalAnswer: 'a bottle', aliases: ['bottle'] },
    });

    const result = await executeTurnAction('rf-riddle', 'local', { action: 'Walk up to the stone face', statUsed: 'mischief' });

    expect(result.ok).toBe(true);
    const { riddleRepository } = await import('../../repositories/riddleRepository.js');
    expect(riddleRepository.getActive('rf-riddle')).toMatchObject({ source: 'narration', canonicalAnswer: 'a bottle', answerKnown: true, wrongAnswers: ['a shirt'] });
    const stored = await StateService.getTurnHistory('rf-riddle');
    const answers = stored[stored.length - 1].choices.filter(c => c.riddleAnswer);
    expect(answers.find(c => c.riddleCorrect)?.riddleAnswer).toBe('a bottle');
    expect(answers.find(c => c.riddleCorrect === false)?.riddleAnswer).toBe('a shirt');
  });

  it('narrates an item turn from settled facts that include the item itself', async () => {
    const pip = { ...makeTestSession().party[0], hp: 4, inventory: [{ id: 'potion-1', name: 'Healing Potion', description: 'Restores 3 HP', healValue: 3, consumable: true, transferable: true }] };
    await insertSessionState(makeTestSession({ id: 'rf-item', party: [pip, makeTestSession().party[1]], activeCharacterId: 'char-pip' }));

    const result = await executeTurnAction('rf-item', 'local', {
      action: 'use item', statUsed: 'none', actionType: 'use_item', itemId: 'potion-1', characterId: 'char-pip', targetCharacterId: 'char-pip',
    });

    expect(result.ok).toBe(true);
    expect(mockProposeMechanics).toHaveBeenCalledTimes(1);
    expect(mockNarrateResolved).toHaveBeenCalledTimes(1);
    expect(mockGenerateTurn).not.toHaveBeenCalled();
    expect(mockNarrateResolved.mock.calls[0][0].resolvedTurn?.facts.join(' ')).toContain('Pip regained 3 HP');
    expect(result.ok && result.diagnostics?.strategy).toBe('resolved_first');
    expect((await StateService.getSession('rf-item'))?.party[0].hp).toBe(7);
  });

  it('is the default strategy', async () => {
    delete process.env.AI_TURN_STRATEGY;
    const { getTurnStrategy } = await import('../../config/env.js');
    expect(getTurnStrategy()).toBe('resolved_first');
    process.env.AI_TURN_STRATEGY = 'parallel';
    expect(getTurnStrategy()).toBe('parallel');
  });
});

