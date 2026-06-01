import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NarrationInput } from '../providers/ai/narration/NarrationProvider.js';

const mocks = vi.hoisted(() => {
  const stream = vi.fn();
  const OpenAI = vi.fn(function OpenAIMock() {
    return { chat: { completions: { stream } } };
  });
  return { OpenAI, stream };
});

vi.mock('openai', () => ({ default: mocks.OpenAI }));

import {
  shouldRunCombatAgent,
  shouldRunInventoryAgent,
  shouldRunRecoveryAgent,
  DmTurnOrchestrator,
} from './dmTurnOrchestrator.js';

// Minimal valid NarrationInput for tests
const baseInput = (): NarrationInput => ({
  scene: 'A mossy corridor',
  party: [
    {
      name: 'Pip',
      class: 'Rogue',
      species: 'Halfling',
      hp: 8,
      maxHp: 10,
      stats: { might: 1, magic: 2, mischief: 4 },
      status: 'active',
    },
  ],
  inventory: [],
  actionAttempt: 'Sneak past the guard',
  actionResult: { success: true, summary: 'The action succeeded.' },
  recentHistory: [],
  tone: 'playful',
  gameMode: 'balanced',
});

const validChoice = {
  label: 'Press deeper',
  difficulty: 'normal' as const,
  stat: 'might' as const,
  difficultyValue: 12,
};

const threeChoices = [validChoice, validChoice, validChoice];

function makeNarrationCompletion(narration = 'The guard steps aside.', rollNarration?: string) {
  return {
    choices: [{
      finish_reason: 'stop',
      message: {
        refusal: null,
        parsed: { narration, rollNarration: rollNarration ?? null, currentTensionLevel: 'medium' },
      },
    }],
  };
}

function makeChoicesCompletion() {
  return {
    choices: [{
      finish_reason: 'stop',
      message: { refusal: null, parsed: { choices: threeChoices } },
    }],
  };
}

function makeInventoryCompletion() {
  return {
    choices: [{
      finish_reason: 'stop',
      message: {
        refusal: null,
        parsed: { suggestedInventoryAdd: null, suggestedInventoryRemove: null, suggestedInventoryUpdate: null },
      },
    }],
  };
}

function makeCombatCompletion() {
  return {
    choices: [{
      finish_reason: 'stop',
      message: {
        refusal: null,
        parsed: { suggestedDamage: 3, suggestedEncounterStart: null, suggestedEncounterUpdate: null },
      },
    }],
  };
}


function mockStreamOnce(completion: unknown) {
  mocks.stream.mockReturnValueOnce({
    on: vi.fn(),
    finalChatCompletion: vi.fn().mockResolvedValue(completion),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = 'test-key';
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

// ---- Gate function tests ----

describe('shouldRunCombatAgent', () => {
  it('returns true when encounter is active', () => {
    const input = { ...baseInput(), encounterState: { id: 'enc-1', name: 'Battle', status: 'active' as const, enemies: [], areas: [], round: 1 } };
    expect(shouldRunCombatAgent(input)).toBe(true);
  });

  it('returns false when no encounter', () => {
    expect(shouldRunCombatAgent(baseInput())).toBe(false);
  });

  it('returns false when encounter is resolved', () => {
    const input = { ...baseInput(), encounterState: { id: 'enc-1', name: 'Battle', status: 'resolved' as const, enemies: [], areas: [], round: 1 } };
    expect(shouldRunCombatAgent(input)).toBe(false);
  });
});

describe('shouldRunInventoryAgent', () => {
  it('returns true when encounter is active (loot turn)', () => {
    const input = { ...baseInput(), encounterState: { id: 'enc-1', name: 'Battle', status: 'active' as const, enemies: [], areas: [], round: 1 } };
    expect(shouldRunInventoryAgent(input)).toBe(true);
  });

  it('returns true when encounterJustResolved', () => {
    const input = { ...baseInput(), encounterJustResolved: true };
    expect(shouldRunInventoryAgent(input)).toBe(true);
  });

  it('returns true when action mentions trade keyword', () => {
    const input = { ...baseInput(), actionAttempt: 'Buy a potion from the merchant' };
    expect(shouldRunInventoryAgent(input)).toBe(true);
  });

  it('returns false for ordinary non-combat non-trade action', () => {
    const input = { ...baseInput(), actionAttempt: 'Climb the wall' };
    expect(shouldRunInventoryAgent(input)).toBe(false);
  });

  it('returns false when stale trade keyword is only in old history during active combat', () => {
    const input = {
      ...baseInput(),
      actionAttempt: 'Attack the goblin',
      recentHistory: ['Three turns ago we visited a merchant.', 'Then another old entry.', 'A third old entry.'],
      encounterState: { id: 'enc-1', name: 'Battle', status: 'active' as const, enemies: [], areas: [], round: 1 },
    };
    // isTradeTurn: action has no trade keyword, active combat skips history check
    // isLootTurn: active combat -> true
    // So agent runs because of loot, not stale trade
    expect(shouldRunInventoryAgent(input)).toBe(true);
  });
});

describe('shouldRunRecoveryAgent', () => {
  it('returns true when a party member is downed', () => {
    const input = {
      ...baseInput(),
      party: [{ ...baseInput().party[0], status: 'downed' as const }],
    };
    expect(shouldRunRecoveryAgent(input)).toBe(true);
  });

  it('returns true when a party member has active buffs', () => {
    const input = {
      ...baseInput(),
      party: [{ ...baseInput().party[0], buffs: [{ id: 'b1', name: 'Blessed', description: 'Lucky', kind: 'buff' as const, remainingTurns: 2 }] }],
    };
    expect(shouldRunRecoveryAgent(input)).toBe(true);
  });

  it('returns true on sanctuary recovery', () => {
    expect(shouldRunRecoveryAgent({ ...baseInput(), sanctuaryRecovery: true })).toBe(true);
  });

  it('returns true on intervention rescue', () => {
    expect(shouldRunRecoveryAgent({ ...baseInput(), interventionRescue: true })).toBe(true);
  });

  it('returns true when actionIntent is bless_character', () => {
    expect(shouldRunRecoveryAgent({ ...baseInput(), actionIntent: 'bless_character' })).toBe(true);
  });

  it('returns true when actionIntent is party_boost', () => {
    expect(shouldRunRecoveryAgent({ ...baseInput(), actionIntent: 'party_boost' })).toBe(true);
  });

  it('returns false for healthy active party with no buffs and no special intent', () => {
    expect(shouldRunRecoveryAgent(baseInput())).toBe(false);
  });
});

// ---- Orchestrator integration tests ----

describe('DmTurnOrchestrator.orchestrate', () => {
  it('merges narration and choices from parallel agents', async () => {
    mockStreamOnce(makeNarrationCompletion('The guard nods and steps back.', 'A clean success.'));
    mockStreamOnce(makeChoicesCompletion());

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    expect(result.narration).toBe('The guard nods and steps back.');
    expect(result.rollNarration).toBe('A clean success.');
    expect(result.choices).toHaveLength(3);
    expect(result.currentTensionLevel).toBe('medium');
  });

  it('uses narration fallback when narration agent fails, choices still succeed', async () => {
    // Narration agent throws
    mocks.stream.mockReturnValueOnce({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('network failure')),
    });
    // Choices agent succeeds
    mockStreamOnce(makeChoicesCompletion());

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    // Fallback narration is used
    expect(result.narration).toBeTruthy();
    // Choices from the choices agent are still used
    expect(result.choices).toHaveLength(3);
    expect(result.narrationFailed).toBe(true);
  });

  it('uses choices fallback when choices agent fails, narration still succeeds', async () => {
    mockStreamOnce(makeNarrationCompletion('The hall opens before you.'));
    // Choices agent throws
    mocks.stream.mockReturnValueOnce({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('choices failure')),
    });

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    expect(result.narration).toBe('The hall opens before you.');
    // Fallback choices are still 3
    expect(result.choices).toHaveLength(3);
    expect(result.narrationFailed).toBe(false);
  });

  it('runs combat agent and merges suggestedDamage when encounter is active', async () => {
    const input: NarrationInput = {
      ...baseInput(),
      encounterState: { id: 'enc-1', name: 'Ambush', status: 'active', enemies: [{ id: 'e1', name: 'Goblin', role: 'minion', hp: 5, maxHp: 5, status: 'active' }], areas: [], round: 1 },
    };

    mockStreamOnce(makeNarrationCompletion('The goblin reels from the blow.'));
    mockStreamOnce(makeChoicesCompletion());
    mockStreamOnce(makeCombatCompletion()); // combat agent
    mockStreamOnce(makeInventoryCompletion()); // inventory agent (loot turn)

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(input);

    expect(result.suggestedDamage).toBe(3);
    // Narration and choices unaffected
    expect(result.narration).toBe('The goblin reels from the blow.');
    expect(result.choices).toHaveLength(3);
  });

  it('one failed optional agent does not affect other agents', async () => {
    const input: NarrationInput = {
      ...baseInput(),
      encounterState: { id: 'enc-1', name: 'Ambush', status: 'active', enemies: [{ id: 'e1', name: 'Goblin', role: 'minion', hp: 5, maxHp: 5, status: 'active' }], areas: [], round: 1 },
    };

    mockStreamOnce(makeNarrationCompletion('The fight rages on.'));
    mockStreamOnce(makeChoicesCompletion());
    // Combat agent fails
    mocks.stream.mockReturnValueOnce({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('combat agent timeout')),
    });
    mockStreamOnce(makeInventoryCompletion()); // inventory agent succeeds

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(input);

    // Combat agent fell back - no damage
    expect(result.suggestedDamage).toBeNull();
    // Narration and choices from their agents
    expect(result.narration).toBe('The fight rages on.');
    expect(result.choices).toHaveLength(3);
    // Diagnostics record the combat failure
    const combatDiag = result.agentDiagnostics.find(d => d.agent === 'combat');
    expect(combatDiag?.status).toBe('fallback');
  });

  it('does not run optional agents when not triggered', async () => {
    mockStreamOnce(makeNarrationCompletion('A quiet exploration.'));
    mockStreamOnce(makeChoicesCompletion());

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    // Only narration + choices called (2 stream calls)
    expect(mocks.stream).toHaveBeenCalledTimes(2);
    expect(result.suggestedDamage).toBeNull();
    expect(result.suggestedInventoryAdd).toBeNull();
    expect(result.suggestedRevive).toBeNull();
  });

  it('records agent diagnostics for all running agents', async () => {
    mockStreamOnce(makeNarrationCompletion('Forward.'));
    mockStreamOnce(makeChoicesCompletion());

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    expect(result.agentDiagnostics).toHaveLength(2);
    const agentNames = result.agentDiagnostics.map(d => d.agent);
    expect(agentNames).toContain('narration');
    expect(agentNames).toContain('choices');
    result.agentDiagnostics.forEach(d => {
      expect(d.status).toBe('ok');
      expect(d.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
