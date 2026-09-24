import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateService } from '../../services/stateService.js';
import { executeTurnAction } from '../../services/turnService.js';
import { FIXED_NARRATION_OUTPUT, mockGenerateTurn, resetMockNarrationProvider } from './mockNarrationProvider.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createMockNarrationProvider } = await import('./mockNarrationProvider.js');
  return {
    createNarrationProvider: vi.fn(() => createMockNarrationProvider()),
    createChatClientForTier: vi.fn(),
  };
});

let paths: IntegrationTestPaths;

beforeAll(() => {
  paths = setupIntegrationEnvironment('item-action');
});

beforeEach(() => {
  resetMockNarrationProvider();
});

afterAll(() => {
  cleanupIntegrationEnvironment(paths);
});

describe('executeTurnAction item action integration', () => {
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
      id: 'item-action-session',
      party: [pip],
      activeCharacterId: 'char-pip',
    }));

    const result = await executeTurnAction('item-action-session', 'local', {
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

    expect(mockGenerateTurn).toHaveBeenCalledTimes(1);
    expect(mockGenerateTurn.mock.calls[0][0].actionAttempt).toContain('Pip used Healing Potion');
    expect(mockGenerateTurn.mock.calls[0][0].inventory).toEqual([]);

    const stored = await StateService.getSession('item-action-session');
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
});

describe('executeTurnAction item action turn_complete metrics', () => {
  it('logs choicesEscalated beside choicesFailed through production console.log', async () => {
    resetMockNarrationProvider({ ...FIXED_NARRATION_OUTPUT, choicesFailed: false, choicesEscalated: true } as typeof FIXED_NARRATION_OUTPUT);
    const log = vi.spyOn(console, 'log');
    await insertSessionState(makeTestSession({
      id: 'item-action-metrics-session',
      party: [{
        ...makeTestSession().party[0],
        hp: 4,
        inventory: [{ id: 'potion-2', name: 'Healing Potion', description: 'Restores 3 HP', healValue: 3, consumable: true, transferable: true }],
      }],
      activeCharacterId: 'char-pip',
    }));

    const result = await executeTurnAction('item-action-metrics-session', 'local', {
      action: 'use item',
      statUsed: 'none',
      actionType: 'use_item',
      itemId: 'potion-2',
      characterId: 'char-pip',
      targetCharacterId: 'char-pip',
    });

    expect(result.ok).toBe(true);
    const line = log.mock.calls.map(call => String(call[0])).find(message => message.includes('[Metrics] turn_complete session=item-action-metrics-session'));
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
      expect((await StateService.getSession('item-action-limit-session'))?.party[0].inventory).toHaveLength(1);
    } finally {
      StateService.setNamespaceLimits('local', null, null);
    }
  });
});
