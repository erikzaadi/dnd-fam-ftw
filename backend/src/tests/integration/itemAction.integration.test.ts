import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateService } from '../../services/stateService.js';
import { executeTurnAction } from '../../services/turnService.js';
import { mockGenerateTurn, resetMockNarrationProvider } from './mockNarrationProvider.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createMockNarrationProvider } = await import('./mockNarrationProvider.js');
  return {
    createNarrationProvider: vi.fn(() => createMockNarrationProvider()),
    createChatClient: vi.fn(),
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
