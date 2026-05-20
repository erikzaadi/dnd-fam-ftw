import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../types.js';

const mocks = vi.hoisted(() => ({
  createMock: vi.fn(),
}));

vi.mock('../providers/ai/AiProviderFactory.js', () => ({
  createChatClientForTier: mocks.createMock,
}));

const makeSession = (): SessionState => ({
  id: 'repair-session',
  scene: 'Rune vault',
  sceneId: 'repair-scene',
  worldDescription: 'A magical merchant vault',
  turn: 7,
  party: [],
  activeCharacterId: 'char-1',
  npcs: [],
  quests: [],
  lastChoices: [],
  tone: 'adventure',
  recentHistory: [],
  difficulty: 'normal',
  storySummary: 'The party is inside the rune vault.',
  displayName: 'Repair Test',
  savingsMode: true,
  interventionState: { rescuesUsed: 0 },
  encounterState: {
    id: 'enc-1',
    name: 'Rune Pillars To',
    status: 'active',
    enemies: [{
      id: 'enemy-1',
      name: 'Rune Pillars To',
      aliases: ['rune', 'pillars'],
      role: 'standard',
      hp: 6,
      maxHp: 6,
      traits: ['absorbs minor blows'],
      weaknesses: [{ id: 'weak-1', label: 'bold teamwork', school: 'force', revealed: false }],
      status: 'active',
    }],
    areas: [],
    round: 1,
    objective: 'Stop Rune Pillars To',
  },
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('repairEncounterNameIfNeeded', () => {
  it('uses the preview model to repair low-quality dynamic encounter names', async () => {
    mocks.createMock.mockReturnValue({
      model: 'gpt-4.1-nano',
      client: {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: 'Ledger Rune Sentinel' } }],
            }),
          },
        },
      },
    });
    const { repairEncounterNameIfNeeded } = await import('./encounterNameRepairService.js');
    const previousSession = makeSession();
    const newState = makeSession();

    await repairEncounterNameIfNeeded(previousSession, newState, {
      narration: 'A rune pillar lurches forward as audit sparks fly.',
      actionAttempt: 'Strike the rune pillar',
    });

    expect(mocks.createMock).toHaveBeenCalledWith('preview');
    expect(newState.encounterState?.name).toBe('Ledger Rune Sentinel');
    expect(newState.encounterState?.enemies[0].name).toBe('Ledger Rune Sentinel');
    expect(newState.encounterState?.enemies[0].aliases).toEqual(['ledger', 'rune', 'sentinel']);
    expect(newState.encounterState?.objective).toBe('Stop Ledger Rune Sentinel');
  });

  it('falls back to a salvaged name when the preview call fails', async () => {
    mocks.createMock.mockReturnValue({
      model: 'gpt-4.1-nano',
      client: {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error('timeout')),
          },
        },
      },
    });
    const { repairEncounterNameIfNeeded } = await import('./encounterNameRepairService.js');
    const previousSession = makeSession();
    const newState = makeSession();

    await repairEncounterNameIfNeeded(previousSession, newState, {
      narration: 'The damaged rune pillars grind across the vault floor.',
      actionAttempt: 'Blast the rune pillars',
    });

    expect(newState.encounterState?.name).toBe('Rune Pillars');
    expect(newState.encounterState?.enemies[0].name).toBe('Rune Pillars');
  });
});
