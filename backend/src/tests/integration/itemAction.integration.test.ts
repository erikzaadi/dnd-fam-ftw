import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateService } from '../../services/stateService.js';
import { executeTurnAction } from '../../services/turnService.js';
import { FIXED_NARRATION_OUTPUT, TURN_STRATEGIES, expectTurnStrategy, mockGenerateTurn, mockNarrateResolved, mockProposeMechanics, narratingMock, narrationInputFor, scriptTurnOutput } from './mockNarrationProvider.js';
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
  paths = setupIntegrationEnvironment('item-action');
});

beforeEach(() => {
  scriptTurnOutput();
});

afterEach(() => {
  delete process.env.AI_TURN_STRATEGY;
});

afterAll(() => {
  cleanupIntegrationEnvironment(paths);
});

// Item effects are applied by the engine before any AI call, under either strategy.
// The healing item must heal exactly once: resolved_first once added a second heal
// from the attempt text through the free-action healing policy.
describe.each(TURN_STRATEGIES)('executeTurnAction item action integration (%s)', (strategy) => {
  beforeEach(() => {
    process.env.AI_TURN_STRATEGY = strategy;
  });

  it('uses a consumable healing item, persists HP/inventory changes, and reports change metadata', async () => {
    const pip = {
      ...makeTestSession().party[0],
      hp: 4,
      inventory: [{
        id: 'potion-1',
        name: 'Healing Potion',
        description: 'Restores 3 HP',
        healValue: 3,
        consumable: true,
        transferable: true,
      }],
    };
    await insertSessionState(makeTestSession({
      id: `item-action-session-${strategy}`,
      party: [pip],
      activeCharacterId: 'char-pip',
    }));

    const result = await executeTurnAction(`item-action-session-${strategy}`, 'local', {
      action: 'use item',
      statUsed: 'none',
      actionType: 'use_item',
      itemId: 'potion-1',
      characterId: 'char-pip',
      targetCharacterId: 'char-pip',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expectTurnStrategy(result, strategy);
    expect(narratingMock(strategy)).toHaveBeenCalledTimes(1);
    expect(narrationInputFor(strategy)?.actionAttempt).toContain('Pip used Healing Potion');
    expect(narrationInputFor(strategy)?.inventory).toEqual([]);
    if (strategy === 'resolved_first') {
      expect(narrationInputFor(strategy)?.resolvedTurn?.facts.join(' ')).toContain('Pip regained 3 HP');
    }

    const stored = await StateService.getSession(`item-action-session-${strategy}`);
    expect(stored?.party[0].hp).toBe(7);
    expect(stored?.party[0].inventory).toHaveLength(0);

    expect(result.body.turnResult.lastAction?.actionAttempt).toContain('Pip used Healing Potion');
    expect(result.body.turnResult.hpChanges).toEqual([
      { characterId: 'char-pip', characterName: 'Pip', change: 3, newHp: 7, maxHp: 10 },
    ]);
    expect(result.body.turnResult.inventoryChanges).toEqual([
      { characterName: 'Pip', itemName: 'Healing Potion', type: 'removed' },
    ]);
  });

  it('logs choicesEscalated beside choicesFailed through production console.log', async () => {
    scriptTurnOutput({ ...FIXED_NARRATION_OUTPUT, choicesFailed: false, choicesEscalated: true } as typeof FIXED_NARRATION_OUTPUT);
    const log = vi.spyOn(console, 'log');
    await insertSessionState(makeTestSession({
      id: `item-action-metrics-session-${strategy}`,
      party: [{
        ...makeTestSession().party[0],
        hp: 4,
        inventory: [{ id: 'potion-2', name: 'Healing Potion', description: 'Restores 3 HP', healValue: 3, consumable: true, transferable: true }],
      }],
      activeCharacterId: 'char-pip',
    }));

    const result = await executeTurnAction(`item-action-metrics-session-${strategy}`, 'local', {
      action: 'use item',
      statUsed: 'none',
      actionType: 'use_item',
      itemId: 'potion-2',
      characterId: 'char-pip',
      targetCharacterId: 'char-pip',
    });

    expectTurnStrategy(result, strategy);
    const line = log.mock.calls.map(call => String(call[0])).find(message => message.includes(`[Metrics] turn_complete session=item-action-metrics-session-${strategy}`));
    expect(line).toContain('choicesFailed=false choicesEscalated=true');
    log.mockRestore();
  });
});

describe('executeTurnAction item action limits', () => {
  it('applies the namespace turn limit to item turns like any other turn', async () => {
    await insertSessionState(makeTestSession({
      id: 'item-action-limit-session',
      turn: 3,
      party: [{
        ...makeTestSession().party[0],
        inventory: [{ id: 'potion-3', name: 'Healing Potion', description: 'Restores 3 HP', healValue: 3, consumable: true, transferable: true }],
      }],
      activeCharacterId: 'char-pip',
    }));
    StateService.setNamespaceLimits('local', null, 2);
    try {
      const result = await executeTurnAction('item-action-limit-session', 'local', {
        action: 'use item',
        statUsed: 'none',
        actionType: 'use_item',
        itemId: 'potion-3',
        characterId: 'char-pip',
      });
      expect(result).toMatchObject({ ok: false, status: 403, body: { error: 'turn_limit' } });
      expect(mockGenerateTurn).not.toHaveBeenCalled();
      expect(mockProposeMechanics).not.toHaveBeenCalled();
      expect(mockNarrateResolved).not.toHaveBeenCalled();
      expect((await StateService.getSession('item-action-limit-session'))?.party[0].inventory).toHaveLength(1);
    } finally {
      StateService.setNamespaceLimits('local', null, null);
    }
  });
});
