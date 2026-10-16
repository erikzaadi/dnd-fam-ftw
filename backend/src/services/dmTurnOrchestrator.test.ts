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
  hasEncounterStartSignal,
  DmTurnOrchestrator,
  runChoicesWithRetry,
  toPlayerChoices,
  type ChoicesRequestInfo,
  type StructuredRequestMeasurement,
} from './dmTurnOrchestrator.js';
import { baseInput, MODEL_REFRESH_CHOICES_FIXTURES } from '../tests/fixtures/model-refresh-choices.js';

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
  // clearAllMocks keeps queued mockReturnValueOnce values; a test that queues more
  // streams than it uses would otherwise hand them to the next test.
  mocks.stream.mockReset();
  process.env.OPENAI_API_KEY = 'test-key';
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

// ---- Gate function tests ----

describe('hasEncounterStartSignal', () => {
  it('returns false when encounter is already active', () => {
    const input = { ...baseInput(), encounterState: { id: 'enc-1', name: 'Battle', status: 'active' as const, enemies: [], areas: [], round: 1 }, sceneMomentum: { directive: 'climax_pressure' as const, suggestedNextBeat: 'suggestedEncounterStart', staleChoiceCount: 0, turnsSinceSceneChange: 1, turnsSinceCombat: 0, justCompletedCombat: false, justCompletedDifficultChallenge: false, reason: 'test' } };
    expect(hasEncounterStartSignal(input)).toBe(false);
  });

  it('returns true when suggestedNextBeat includes suggestedEncounterStart', () => {
    const input = { ...baseInput(), sceneMomentum: { directive: 'press_current_scene' as const, suggestedNextBeat: 'Start a goblin fight via suggestedEncounterStart', staleChoiceCount: 0, turnsSinceSceneChange: 2, turnsSinceCombat: 5, justCompletedCombat: false, justCompletedDifficultChallenge: false, reason: 'test' } };
    expect(hasEncounterStartSignal(input)).toBe(true);
  });

  it('returns true when directive is climax_pressure and no active encounter', () => {
    const input = { ...baseInput(), sceneMomentum: { directive: 'climax_pressure' as const, suggestedNextBeat: 'Villain arrives', staleChoiceCount: 0, turnsSinceSceneChange: 3, turnsSinceCombat: 3, justCompletedCombat: false, justCompletedDifficultChallenge: false, reason: 'test' } };
    expect(hasEncounterStartSignal(input)).toBe(true);
  });

  it('returns true when gameMode is zug-ma-geddon and no active encounter', () => {
    expect(hasEncounterStartSignal({ ...baseInput(), gameMode: 'zug-ma-geddon' })).toBe(true);
  });

  it('returns false for ordinary exploration turn with no signals', () => {
    expect(hasEncounterStartSignal(baseInput())).toBe(false);
  });

  it('returns false when directive is press_current_scene with no encounter-start beat', () => {
    const input = { ...baseInput(), sceneMomentum: { directive: 'press_current_scene' as const, suggestedNextBeat: 'Keep exploring the dungeon', staleChoiceCount: 0, turnsSinceSceneChange: 1, turnsSinceCombat: 2, justCompletedCombat: false, justCompletedDifficultChallenge: false, reason: 'test' } };
    expect(hasEncounterStartSignal(input)).toBe(false);
  });
});

describe('shouldRunCombatAgent', () => {
  it('returns true when encounter is active', () => {
    const input = { ...baseInput(), encounterState: { id: 'enc-1', name: 'Battle', status: 'active' as const, enemies: [], areas: [], round: 1 } };
    expect(shouldRunCombatAgent(input)).toBe(true);
  });

  it('returns true when hasEncounterStartSignal is true even with no active encounter', () => {
    const input = { ...baseInput(), sceneMomentum: { directive: 'climax_pressure' as const, suggestedNextBeat: 'Villain arrives', staleChoiceCount: 0, turnsSinceSceneChange: 3, turnsSinceCombat: 3, justCompletedCombat: false, justCompletedDifficultChallenge: false, reason: 'test' } };
    expect(shouldRunCombatAgent(input)).toBe(true);
  });

  it('returns false when no encounter and no start signal', () => {
    expect(shouldRunCombatAgent(baseInput())).toBe(false);
  });

  it('returns false when encounter is resolved and no start signal', () => {
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

// Suggestions come only from the ideas endpoint (generateIdeas); a turn never runs the
// choices agent, its retries, or the fallback choices.
describe('turns without suggestions', () => {
  it('runs no choices agent, retry, or fallback in the parallel pipeline', async () => {
    mockStreamOnce(makeNarrationCompletion('The guard steps aside. Pip, what do you try?'));

    const result = await new DmTurnOrchestrator().orchestrate(baseInput());

    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(result.choices).toEqual([]);
    expect(result.choicesFailed).toBe(false);
    expect(result.choicesEscalated).toBe(false);
  });

  it('runs no choices agent when narration falls back either', async () => {
    mocks.stream.mockReturnValueOnce({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('network failure')),
    });

    const result = await new DmTurnOrchestrator().orchestrate(baseInput());

    expect(result.narrationFailed).toBe(true);
    expect(result.choices).toEqual([]);
    expect(result.choicesFailed).toBe(false);
  });

  it('runs no choices agent in the resolved-first presentation', async () => {
    mockStreamOnce(makeNarrationCompletion('The door creaks open.'));

    const result = await new DmTurnOrchestrator().narrateResolved(baseInput());

    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(result.choices).toEqual([]);
  });
});

describe('DmTurnOrchestrator.orchestrate', () => {
  it('returns the narration agent output with no suggestions', async () => {
    mockStreamOnce(makeNarrationCompletion('The guard nods and steps back.', 'A clean success.'));

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    expect(result.narration).toBe('The guard nods and steps back.');
    expect(result.rollNarration).toBe('A clean success.');
    expect(result.choices).toEqual([]);
    expect(result.currentTensionLevel).toBe('medium');
  });

  it('uses narration fallback when narration agent fails', async () => {
    // Narration agent throws
    mocks.stream.mockReturnValueOnce({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('network failure')),
    });

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    // Fallback narration is used
    expect(result.narration).toBeTruthy();
    expect(result.narrationFailed).toBe(true);
  });

  it('runs combat agent and merges suggestedDamage when encounter is active', async () => {
    const input: NarrationInput = {
      ...baseInput(),
      encounterState: { id: 'enc-1', name: 'Ambush', status: 'active', enemies: [{ id: 'e1', name: 'Goblin', role: 'minion', hp: 5, maxHp: 5, status: 'active' }], areas: [], round: 1 },
    };

    mockStreamOnce(makeNarrationCompletion('The goblin reels from the blow.'));
    mockStreamOnce(makeCombatCompletion()); // combat agent
    mockStreamOnce(makeInventoryCompletion()); // inventory agent (loot turn)

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(input);

    expect(result.suggestedDamage).toBe(3);
    // Narration unaffected
    expect(result.narration).toBe('The goblin reels from the blow.');
    expect(result.choices).toEqual([]);
  });

  it('one failed optional agent does not affect other agents', async () => {
    const input: NarrationInput = {
      ...baseInput(),
      encounterState: { id: 'enc-1', name: 'Ambush', status: 'active', enemies: [{ id: 'e1', name: 'Goblin', role: 'minion', hp: 5, maxHp: 5, status: 'active' }], areas: [], round: 1 },
    };

    mockStreamOnce(makeNarrationCompletion('The fight rages on.'));
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
    // Narration from its agent
    expect(result.narration).toBe('The fight rages on.');
    // Diagnostics record the combat failure
    const combatDiag = result.agentDiagnostics.find(d => d.agent === 'combat');
    expect(combatDiag?.status).toBe('fallback');
  });

  it('does not run optional agents when not triggered', async () => {
    mockStreamOnce(makeNarrationCompletion('A quiet exploration.'));

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    // Only narration is called
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(result.suggestedDamage).toBeNull();
    expect(result.suggestedInventoryAdd).toBeNull();
    expect(result.suggestedRevive).toBeNull();
  });

  it('records agent diagnostics for all running agents', async () => {
    mockStreamOnce(makeNarrationCompletion('Forward.'));

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    expect(result.agentDiagnostics).toHaveLength(1);
    const agentNames = result.agentDiagnostics.map(d => d.agent);
    expect(agentNames).toContain('narration');
    result.agentDiagnostics.forEach(d => {
      expect(d.status).toBe('ok');
      expect(d.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  it('strips em dashes from narration even when the model ignores the prompt rule', async () => {
    mockStreamOnce(makeNarrationCompletion('The gate creaks open—revealing a hall of mirrors.', 'A clean hit—right on target.'));
    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    expect(result.narration).toBe('The gate creaks open-revealing a hall of mirrors.');
    expect(result.rollNarration).toBe('A clean hit-right on target.');
  });

  it('propagates currentTensionLevel from the narration agent to the final result', async () => {
    mockStreamOnce({
      choices: [{
        finish_reason: 'stop',
        message: {
          refusal: null,
          parsed: { narration: 'The dragon descends.', rollNarration: null, currentTensionLevel: 'high' },
        },
      }],
    });

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    expect(result.currentTensionLevel).toBe('high');
  });

  it('narration agent refusal triggers fallback instead of a propagated throw', async () => {
    mockStreamOnce({
      choices: [{
        finish_reason: 'stop',
        message: { refusal: 'I cannot continue this story.', parsed: null },
      }],
    });

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    expect(result.narration).toBeTruthy();
    expect(result.narrationFailed).toBe(true);
  });

  it('narration agent malformed stream (no parsed output) triggers fallback', async () => {
    mockStreamOnce({
      choices: [{ finish_reason: 'length', message: { refusal: null, parsed: null } }],
    });

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    expect(result.narration).toBeTruthy();
    expect(result.narrationFailed).toBe(true);
  });

  it('hanging agents resolve to fallback at the deadline instead of hanging the turn', async () => {
    vi.useFakeTimers();
    try {
      mocks.stream.mockReturnValue({
        on: vi.fn(),
        finalChatCompletion: vi.fn(() => new Promise(() => {})),
      });

      const orchestrator = new DmTurnOrchestrator();
      const promise = orchestrator.orchestrate(baseInput());
      // Narration deadline 6000ms
      await vi.advanceTimersByTimeAsync(6100);
      const result = await promise;

      expect(result.narrationFailed).toBe(true);
      expect(result.choices).toEqual([]);
      result.agentDiagnostics.forEach(d => {
        expect(d.status).toBe('timeout');
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('first turn gets a relaxed narration deadline instead of the standard 6s', async () => {
    vi.useFakeTimers();
    try {
      mocks.stream.mockReturnValue({
        on: vi.fn(),
        finalChatCompletion: vi.fn(() => new Promise(() => {})),
      });

      const orchestrator = new DmTurnOrchestrator();
      const promise = orchestrator.orchestrate({ ...baseInput(), isFirstTurn: true });
      let settled = false;
      void promise.then(() => {
        settled = true;
      });

      // Standard narration deadline (6000ms) must NOT fire on a first turn
      await vi.advanceTimersByTimeAsync(6100);
      expect(settled).toBe(false);

      // Relaxed deadline (8000ms) eventually resolves to fallback
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;
      expect(result.narrationFailed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('all agents failing produces a coherent full-fallback result', async () => {
    mocks.stream.mockReturnValue({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('provider down')),
    });

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    expect(result.narration).toBeTruthy();
    expect(result.choices).toEqual([]);
    expect(result.narrationFailed).toBe(true);
    expect(result.currentTensionLevel).toBeTruthy();
    expect(result.suggestedDamage).toBeNull();
    expect(result.suggestedInventoryAdd).toBeNull();
  });

  it('inventory agent retries once on parse error and uses the retry output', async () => {
    const input: NarrationInput = { ...baseInput(), actionAttempt: 'Trade the sword for a lantern' };

    mockStreamOnce(makeNarrationCompletion('The trade is struck.'));
    // First inventory call: malformed (no parsed) -> triggers the single retry
    mockStreamOnce({ choices: [{ finish_reason: 'stop', message: { refusal: null, parsed: null } }] });
    mockStreamOnce({
      choices: [{
        finish_reason: 'stop',
        message: {
          refusal: null,
          parsed: {
            suggestedInventoryAdd: { name: '🏮 Brass Lantern', description: 'A sturdy lantern', statBonuses: {} },
            suggestedInventoryRemove: null,
            suggestedInventoryUpdate: null,
          },
        },
      }],
    });

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(input);

    expect(mocks.stream).toHaveBeenCalledTimes(3);
    expect(result.suggestedInventoryAdd?.name).toBe('🏮 Brass Lantern');
    const inventoryDiag = result.agentDiagnostics.find(d => d.agent === 'inventory');
    expect(inventoryDiag?.status).toBe('retry');
  });

  it('inventory agent falls back after exactly one failed retry', async () => {
    const input: NarrationInput = { ...baseInput(), actionAttempt: 'Trade the sword for a lantern' };

    mockStreamOnce(makeNarrationCompletion('The trade is struck.'));
    // Both inventory attempts malformed -> fallback, no third attempt
    mockStreamOnce({ choices: [{ finish_reason: 'stop', message: { refusal: null, parsed: null } }] });
    mockStreamOnce({ choices: [{ finish_reason: 'stop', message: { refusal: null, parsed: null } }] });

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(input);

    expect(mocks.stream).toHaveBeenCalledTimes(3);
    expect(result.suggestedInventoryAdd).toBeNull();
    const inventoryDiag = result.agentDiagnostics.find(d => d.agent === 'inventory');
    expect(inventoryDiag?.status).toBe('fallback');
  });

  it('failed agent diagnostic has errorKind=refusal when agent returns a refusal', async () => {
    const input: NarrationInput = {
      ...baseInput(),
      encounterState: { id: 'enc-1', name: 'Ambush', status: 'active', enemies: [], areas: [], round: 1 },
    };

    mockStreamOnce(makeNarrationCompletion('The fight continues.'));
    // Combat agent responds with a content refusal
    mocks.stream.mockReturnValueOnce({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockResolvedValue({
        choices: [{ finish_reason: 'stop', message: { refusal: 'I cannot generate combat content.', parsed: null } }],
      }),
    });
    mockStreamOnce(makeInventoryCompletion());

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(input);

    const combatDiag = result.agentDiagnostics.find(d => d.agent === 'combat');
    expect(combatDiag?.status).toBe('fallback');
    expect(combatDiag?.errorKind).toBe('refusal');
    expect(combatDiag?.errorMessage).toContain('refusal');
  });

  it('timed-out optional agent diagnostic has errorKind=timeout and status=timeout', async () => {
    vi.useFakeTimers();
    try {
      const input: NarrationInput = {
        ...baseInput(),
        encounterState: { id: 'enc-1', name: 'Ambush', status: 'active', enemies: [], areas: [], round: 1 },
      };

      mockStreamOnce(makeNarrationCompletion('The fight rages.'));
      // Combat agent hangs past deadline
      mocks.stream.mockReturnValueOnce({
        on: vi.fn(),
        finalChatCompletion: vi.fn(() => new Promise(() => {})),
      });
      mockStreamOnce(makeInventoryCompletion());

      const orchestrator = new DmTurnOrchestrator();
      const promise = orchestrator.orchestrate(input);
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      const combatDiag = result.agentDiagnostics.find(d => d.agent === 'combat');
      expect(combatDiag?.status).toBe('timeout');
      expect(combatDiag?.errorKind).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DmTurnOrchestrator as NarrationProvider', () => {
  it('generateTurn delegates to orchestrate', async () => {
    mockStreamOnce(makeNarrationCompletion('Through the factory seam.'));

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.generateTurn(baseInput());

    expect(result.narration).toBe('Through the factory seam.');
    expect(result.choices).toEqual([]);
  });
});

// The choices flow behind "Give me ideas": retries, stale and top-stat guards, fallback.
describe('ideas choices flow', () => {
  it('choices agent malformed stream triggers the fallback choices', async () => {
    mockStreamOnce({
      choices: [{ finish_reason: 'stop', message: { refusal: null, parsed: null } }],
    });
    // The retry attempt also fails (malformed again)
    mockStreamOnce({
      choices: [{ finish_reason: 'stop', message: { refusal: null, parsed: null } }],
    });

    const result = await runChoicesWithRetry(baseInput());

    expect(result.choices.choices).toHaveLength(3);
    expect(result.usedFallback).toBe(true);
  });

  it('choices agent timeout retries once and uses the retry output', async () => {
    vi.useFakeTimers();
    try {
      // First choices attempt hangs past its deadline
      mocks.stream.mockReturnValueOnce({
        on: vi.fn(),
        finalChatCompletion: vi.fn(() => new Promise(() => {})),
      });
      // Retry succeeds
      mockStreamOnce(makeChoicesCompletion());

      const promise = runChoicesWithRetry(baseInput());
      await vi.advanceTimersByTimeAsync(3600);
      const result = await promise;

      expect(result.choices.choices).toHaveLength(3);
      expect(result.choices.choices[0].label).toBe('Press deeper');
      expect(result.usedFallback).toBe(false);
      const firstDiag = result.diagnostics.find(d => d.agent === 'choices');
      const retryDiag = result.diagnostics.find(d => d.agent === 'choices-retry');
      expect(firstDiag?.status).toBe('timeout');
      expect(retryDiag?.status).toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries when choices agent returns the same labels as previousChoiceLabels', async () => {
    const previousLabels = ['Press deeper', 'Press deeper', 'Press deeper'];
    const input = { ...baseInput(), previousChoiceLabels: previousLabels, nextCharacterName: 'Pip' };
    // First choices attempt returns the exact same labels as previous turn
    mockStreamOnce(makeChoicesCompletion()); // validChoice label is 'Press deeper' x3
    // Stale retry returns fresh choices
    mockStreamOnce({
      choices: [{
        finish_reason: 'stop',
        message: {
          refusal: null,
          parsed: {
            choices: [
              { ...validChoice, label: 'Smash through the barrier', stat: 'mischief' },
              { ...validChoice, label: 'Scout the route ahead', stat: 'might' },
              { ...validChoice, label: 'Rally the party', stat: 'magic' },
            ],
          },
        },
      }],
    });

    const result = await runChoicesWithRetry(input);

    expect(result.choices.choices[0].label).toBe('Smash through the barrier');
    expect(result.usedFallback).toBe(false);
    const staleDiag = result.diagnostics.find(d => d.agent === 'choices-stale-retry');
    expect(staleDiag?.status).toBe('ok');
  });

  it('uses stale choices as fallback and applies ensureTopStatCoverage when stale retry also fails', async () => {
    const previousLabels = ['Press deeper', 'Press deeper', 'Press deeper'];
    const input = { ...baseInput(), previousChoiceLabels: previousLabels, nextCharacterName: 'Pip' };
    // First attempt: stale
    mockStreamOnce(makeChoicesCompletion());
    // Stale retry fails
    mocks.stream.mockReturnValueOnce({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('retry failure')),
    });

    const result = await runChoicesWithRetry(input);

    // Falls back to the stale choices with ensureTopStatCoverage applied
    // Pip's top stat is mischief (4); 'Press deeper' uses might, so one slot is replaced
    expect(result.choices.choices).toHaveLength(3);
    expect(result.choices.choices.some(c => c.stat === 'mischief')).toBe(true);
    expect(result.usedFallback).toBe(false);
  });

  it('retries choices on the stronger model when no choice uses the next hero top stat', async () => {
    // Pip's top stat is mischief (4); the fixture choices are all might
    const input = { ...baseInput(), nextCharacterName: 'Pip' };
    mockStreamOnce(makeChoicesCompletion());
    // Coverage retry returns a mischief option
    mockStreamOnce({
      choices: [{
        finish_reason: 'stop',
        message: {
          refusal: null,
          parsed: { choices: [{ ...validChoice, stat: 'mischief', label: 'Sneak past the guard' }, validChoice, validChoice] },
        },
      }],
    });

    const result = await runChoicesWithRetry(input);

    expect(result.choices.choices.some(c => c.stat === 'mischief')).toBe(true);
    expect(result.usedFallback).toBe(false);
    expect(result.diagnostics.find(d => d.agent === 'choices-coverage-retry')?.status).toBe('ok');
  });

  it('injects top-stat fallback when the coverage retry fails', async () => {
    const input = { ...baseInput(), nextCharacterName: 'Pip' };
    // All choices use might; Pip's top stat is mischief
    mockStreamOnce(makeChoicesCompletion());
    // Coverage retry fails
    mocks.stream.mockReturnValueOnce({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('retry failure')),
    });

    const result = await runChoicesWithRetry(input);

    expect(result.choices.choices).toHaveLength(3);
    // The weakest-stat (might) choice at index 0 is replaced with the mischief fallback
    expect(result.choices.choices.some(c => c.stat === 'mischief')).toBe(true);
    expect(result.usedFallback).toBe(false);
  });

  it('strips em dashes from idea labels and narration even when the model ignores the prompt rule', async () => {
    mockStreamOnce({
      choices: [{
        finish_reason: 'stop',
        message: {
          refusal: null,
          parsed: {
            choices: [
              { ...validChoice, label: 'Step through—carefully', narration: 'One step at a time—no sudden moves.' },
              validChoice,
              validChoice,
            ],
          },
        },
      }],
    });

    const { choices } = await new DmTurnOrchestrator().generateIdeas(baseInput());

    expect(choices[0].label).toBe('Step through-carefully');
    expect(choices[0].narration).toBe('One step at a time-no sudden moves.');
  });
});

describe('runChoicesWithRetry', () => {
  type RequestEnd = ChoicesRequestInfo & StructuredRequestMeasurement;

  function recordingObserver() {
    const starts: ChoicesRequestInfo[] = [];
    const ends: RequestEnd[] = [];
    return {
      starts,
      ends,
      observer: {
        onRequestStart: (request: ChoicesRequestInfo) => starts.push(request),
        onRequestEnd: (event: RequestEnd) => ends.push(event),
      },
    };
  }

  function mockStreamWithContent(completion: unknown) {
    mocks.stream.mockReturnValueOnce({
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'content') {
          handler();
        }
      }),
      finalChatCompletion: vi.fn().mockResolvedValue(completion),
    });
  }

  const freshChoices = {
    choices: [{
      finish_reason: 'stop',
      message: {
        refusal: null,
        parsed: {
          choices: [
            { ...validChoice, label: 'Smash through the barrier', stat: 'mischief' },
            { ...validChoice, label: 'Scout the route ahead', stat: 'might' },
            { ...validChoice, label: 'Rally the party', stat: 'magic' },
          ],
        },
      },
    }],
  };

  it('returns the initial preview output without escalating when it passes the guards', async () => {
    mockStreamOnce(makeChoicesCompletion());

    const result = await runChoicesWithRetry(baseInput());

    expect(result.escalated).toBe(false);
    expect(result.usedFallback).toBe(false);
    expect(result.initial).toEqual(result.choices);
    expect(result.initialIssues).toEqual({ stale: false, lacksTopStat: false });
    expect(result.diagnostics.map(d => d.agent)).toEqual(['choices']);
    expect(mocks.stream.mock.calls[0][0].model).toBe('gpt-5.6-luna');
  });

  it('marks a stale-label retry as escalated to the narration tier', async () => {
    const input = { ...baseInput(), previousChoiceLabels: ['Press deeper'], nextCharacterName: 'Pip' };
    mockStreamOnce(makeChoicesCompletion());
    mockStreamOnce(freshChoices);

    const result = await runChoicesWithRetry(input);

    expect(result.escalated).toBe(true);
    expect(result.usedFallback).toBe(false);
    expect(result.initialIssues?.stale).toBe(true);
    expect(result.initial?.choices[0].label).toBe('Press deeper');
    expect(result.choices.choices[0].label).toBe('Smash through the barrier');
    expect(mocks.stream.mock.calls[1][0].model).toBe('gpt-6-luna');
  });

  it('marks a stat-coverage retry as escalated even when the retry fails', async () => {
    const input = { ...baseInput(), nextCharacterName: 'Pip' };
    mockStreamOnce(makeChoicesCompletion());
    mocks.stream.mockReturnValueOnce({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('retry failure')),
    });

    const result = await runChoicesWithRetry(input);

    expect(result.escalated).toBe(true);
    expect(result.usedFallback).toBe(false);
    expect(result.initialIssues).toEqual({ stale: false, lacksTopStat: true });
    expect(result.choices.choices.some(c => c.stat === 'mischief')).toBe(true);
  });

  it('reports fallback and escalation when both the initial attempt and error retry fail', async () => {
    mocks.stream.mockReturnValue({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('provider down')),
    });

    const result = await runChoicesWithRetry(baseInput());

    expect(result.escalated).toBe(true);
    expect(result.usedFallback).toBe(true);
    expect(result.initial).toBeNull();
    expect(result.initialIssues).toBeNull();
    expect(result.choices.choices).toHaveLength(3);
    expect(result.diagnostics.map(d => d.agent)).toEqual(['choices', 'choices-retry']);
  });

  it('counts a timed-out narration-tier retry as escalated and uses the ordinary 3500 ms deadline', async () => {
    vi.useFakeTimers();
    try {
      mocks.stream.mockReturnValue({
        on: vi.fn(),
        finalChatCompletion: vi.fn(() => new Promise(() => {})),
      });

      let settled = false;
      const promise = runChoicesWithRetry(baseInput()).then((result) => {
        settled = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(3400);
      expect(mocks.stream).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3200);
      const result = await promise;

      expect(settled).toBe(true);
      expect(result.escalated).toBe(true);
      expect(result.usedFallback).toBe(true);
      expect(result.diagnostics.map(d => d.status)).toEqual(['timeout', 'timeout']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the relaxed 5000 ms initial deadline on first turns', async () => {
    vi.useFakeTimers();
    try {
      mocks.stream.mockReturnValue({
        on: vi.fn(),
        finalChatCompletion: vi.fn(() => new Promise(() => {})),
      });

      const promise = runChoicesWithRetry({ ...baseInput(), isFirstTurn: true });
      await vi.advanceTimersByTimeAsync(4900);
      expect(mocks.stream).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3200);
      const result = await promise;

      expect(mocks.stream).toHaveBeenCalledTimes(2);
      expect(result.escalated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports each physical request to an attached observer', async () => {
    const input = { ...baseInput(), nextCharacterName: 'Pip' };
    mockStreamWithContent({
      ...makeChoicesCompletion(),
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
    });
    mocks.stream.mockReturnValueOnce({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('retry failure')),
    });
    const recorder = recordingObserver();

    await runChoicesWithRetry(input, { observer: recorder.observer });

    expect(recorder.starts).toEqual([
      { agent: 'choices', tier: 'preview', model: 'gpt-5.6-luna' },
      { agent: 'choices-coverage-retry', tier: 'narration', model: 'gpt-6-luna' },
    ]);
    expect(recorder.ends).toHaveLength(2);
    expect(recorder.ends[0]).toMatchObject({
      agent: 'choices',
      finishReason: 'stop',
      usage: { total_tokens: 140 },
      error: null,
    });
    expect(recorder.ends[0].firstContentMs).not.toBeNull();
    expect(recorder.ends[1]).toMatchObject({ agent: 'choices-coverage-retry', finishReason: null, error: 'retry failure' });
  });

  it('shares one diagnostics array with the caller', async () => {
    mockStreamOnce(makeChoicesCompletion());
    const diagnostics = [{ agent: 'narration', durationMs: 1, status: 'ok' as const }];

    const result = await runChoicesWithRetry(baseInput(), { diagnostics });

    expect(result.diagnostics).toBe(diagnostics);
    expect(diagnostics.map(d => d.agent)).toEqual(['narration', 'choices']);
  });

  it('orchestrate does not attach evaluation stream listeners', async () => {
    mockStreamOnce(makeNarrationCompletion('Onward.'));
    mockStreamOnce(makeChoicesCompletion());

    await new DmTurnOrchestrator().orchestrate(baseInput());

    for (const result of mocks.stream.mock.results) {
      expect((result.value as { on: ReturnType<typeof vi.fn> }).on).not.toHaveBeenCalled();
    }
  });
});

describe('model refresh choices fixtures', () => {
  it('has 20 uniquely named fixtures split 15 ordinary / 5 relaxed', () => {
    const ids = MODEL_REFRESH_CHOICES_FIXTURES.map(f => f.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(MODEL_REFRESH_CHOICES_FIXTURES.filter(f => f.deadline === 'ordinary')).toHaveLength(15);
    expect(MODEL_REFRESH_CHOICES_FIXTURES.filter(f => f.deadline === 'relaxed')).toHaveLength(5);
  });

  it('labels relaxed fixtures consistently with the orchestrator relaxed-deadline flags', () => {
    for (const fixture of MODEL_REFRESH_CHOICES_FIXTURES) {
      const input = fixture.build();
      const relaxed = !!(input.isFirstTurn || input.interventionRescue || input.sanctuaryRecovery);
      expect(relaxed, fixture.id).toBe(fixture.deadline === 'relaxed');
    }
  });

  it('names an existing active next character and returns fresh objects', () => {
    for (const fixture of MODEL_REFRESH_CHOICES_FIXTURES) {
      const first = fixture.build();
      const second = fixture.build();
      expect(first, fixture.id).not.toBe(second);
      expect(first.party, fixture.id).not.toBe(second.party);
      expect(first.party.some(c => c.name === first.nextCharacterName && c.status === 'active'), fixture.id).toBe(true);
      expect(fixture.expectedFacts.length, fixture.id).toBeGreaterThan(0);
    }
  });
});

describe('toPlayerChoices', () => {
  it('applies the production item guard to player-visible choices', () => {
    const input = { ...baseInput(), nextCharacterName: 'Pip' };
    const choices = toPlayerChoices({
      choices: [
        { ...validChoice, label: 'Offer a shiny coin', stat: 'mischief', flavor: 'item', itemOwnerName: 'Pip', itemName: 'Shiny Coin' },
        validChoice,
        validChoice,
      ],
    }, input);

    // The label survives even though the invented item metadata is dropped
    expect(choices[0]).toMatchObject({ label: 'Offer a shiny coin', flavor: 'standard' });
    expect(choices[0].itemName).toBeUndefined();
  });
});

describe('choices request settings by tier', () => {
  afterEach(() => {
    delete process.env.OPENAI_REASONING_EFFORT_PREVIEW;
  });

  it('sends preview reasoning on the initial choices request and narration settings on the retry', async () => {
    process.env.OPENAI_REASONING_EFFORT_PREVIEW = 'low';
    const input = { ...baseInput(), nextCharacterName: 'Pip' };
    // Initial choices lack Pip's top stat (mischief), forcing a coverage retry
    mockStreamOnce(makeChoicesCompletion());
    mockStreamOnce(makeChoicesCompletion());

    const result = await runChoicesWithRetry(input);

    expect(result.escalated).toBe(true);
    const [initialRequest, retryRequest] = mocks.stream.mock.calls.map(call => call[0]);
    expect(initialRequest).toMatchObject({ model: 'gpt-5.6-luna', reasoning_effort: 'low', max_completion_tokens: 450 });
    expect(initialRequest).not.toHaveProperty('service_tier');
    expect(retryRequest).toMatchObject({ model: 'gpt-6-luna', reasoning_effort: 'none', service_tier: 'priority' });
  });

  it('sends the built-in reasoning none on choices requests when the preview setting is unset', async () => {
    mockStreamOnce(makeChoicesCompletion());

    await runChoicesWithRetry(baseInput());

    expect(mocks.stream.mock.calls[0][0]).toMatchObject({ model: 'gpt-5.6-luna', reasoning_effort: 'none' });
  });

  it('sends no reasoning field on choices requests with the explicit omit escape hatch', async () => {
    process.env.OPENAI_REASONING_EFFORT_PREVIEW = 'omit';
    mockStreamOnce(makeChoicesCompletion());

    await runChoicesWithRetry(baseInput());

    expect(mocks.stream.mock.calls[0][0]).not.toHaveProperty('reasoning_effort');
  });

  it('never sends preview reasoning on narration or mechanics agent requests', async () => {
    process.env.OPENAI_REASONING_EFFORT_PREVIEW = 'low';
    mockStreamOnce(makeNarrationCompletion('Onward.'));

    await new DmTurnOrchestrator().orchestrate(baseInput());

    const [narrationRequest] = mocks.stream.mock.calls.map(call => call[0]);
    expect(narrationRequest).toMatchObject({ model: 'gpt-6-luna', reasoning_effort: 'none', service_tier: 'priority' });
  });

  it('sends the configured narration settings on narration agent and narration-tier retry requests', async () => {
    process.env.OPENAI_REASONING_EFFORT_NARRATION = 'low';
    process.env.OPENAI_SERVICE_TIER_NARRATION = 'omit';
    try {
      mockStreamOnce(makeNarrationCompletion('Onward.'));
      await new DmTurnOrchestrator().orchestrate(baseInput());
      expect(mocks.stream.mock.calls[0][0]).toMatchObject({ model: 'gpt-6-luna', reasoning_effort: 'low' });
      expect(mocks.stream.mock.calls[0][0]).not.toHaveProperty('service_tier');

      mocks.stream.mockClear();
      mockStreamOnce(makeChoicesCompletion());
      mockStreamOnce(makeChoicesCompletion());
      await runChoicesWithRetry({ ...baseInput(), nextCharacterName: 'Pip' });
      const retryRequest = mocks.stream.mock.calls[1][0];
      expect(retryRequest).toMatchObject({ model: 'gpt-6-luna', reasoning_effort: 'low' });
      expect(retryRequest).not.toHaveProperty('service_tier');
    } finally {
      delete process.env.OPENAI_REASONING_EFFORT_NARRATION;
      delete process.env.OPENAI_SERVICE_TIER_NARRATION;
    }
  });
});

// ---- Streamed narration abort ----

describe('narration abort after streamed text', () => {
  type ContentListener = (delta: string, snapshot: string) => void;
  const controllableStream = () => {
    let listener: ContentListener = () => {};
    let settle: { resolve: (value: unknown) => void; reject: (err: unknown) => void } = { resolve: () => {}, reject: () => {} };
    mocks.stream.mockReturnValueOnce({
      on: vi.fn((event: string, cb: ContentListener) => {
        if (event === 'content') {
          listener = cb;
        }
      }),
      finalChatCompletion: vi.fn(() => new Promise((resolve, reject) => {
        settle = { resolve, reject };
      })),
    });
    return {
      emit: (snapshot: string) => listener('', snapshot),
      resolve: (value: unknown) => settle.resolve(value),
      reject: (err: unknown) => settle.reject(err),
    };
  };
  const makeCallbacks = () => ({ onChunk: vi.fn(), onStreamingDone: vi.fn(), onAbort: vi.fn() });

  it('aborts once when the stream fails after text went out', async () => {
    const stream = controllableStream();
    const callbacks = makeCallbacks();
    const promise = new DmTurnOrchestrator().narrateResolved(baseInput(), callbacks);
    await Promise.resolve();
    stream.emit('{"narration":"The gate');
    stream.reject(new Error('network down'));
    const result = await promise;
    expect(callbacks.onChunk).toHaveBeenCalledTimes(1);
    expect(callbacks.onAbort).toHaveBeenCalledTimes(1);
    expect(result.narrationFailed).toBe(true);
  });

  it('aborts at the deadline before the fallback returns, and ignores late chunks', async () => {
    vi.useFakeTimers();
    try {
      const stream = controllableStream();
      const callbacks = makeCallbacks();
      const promise = new DmTurnOrchestrator().orchestrate(baseInput(), callbacks);
      await Promise.resolve();
      stream.emit('{"narration":"The gate');
      await vi.advanceTimersByTimeAsync(6100);
      const result = await promise;
      expect(callbacks.onAbort).toHaveBeenCalledTimes(1);
      expect(result.narrationFailed).toBe(true);

      stream.emit('{"narration":"The gate creaks open');
      stream.reject(new Error('aborted late'));
      await Promise.resolve();
      expect(callbacks.onChunk).toHaveBeenCalledTimes(1);
      expect(callbacks.onAbort).toHaveBeenCalledTimes(1);
      expect(callbacks.onStreamingDone).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not abort a clean stream', async () => {
    const stream = controllableStream();
    const callbacks = makeCallbacks();
    const promise = new DmTurnOrchestrator().narrateResolved(baseInput(), callbacks);
    await Promise.resolve();
    stream.emit('{"narration":"The gate');
    stream.resolve(makeNarrationCompletion('The gate creaks open.'));
    const result = await promise;
    expect(callbacks.onAbort).not.toHaveBeenCalled();
    expect(callbacks.onStreamingDone).toHaveBeenCalledTimes(1);
    expect(result.narration).toBe('The gate creaks open.');
  });

  it('does not abort a failure before any text', async () => {
    const stream = controllableStream();
    const callbacks = makeCallbacks();
    const promise = new DmTurnOrchestrator().narrateResolved(baseInput(), callbacks);
    await Promise.resolve();
    stream.reject(new Error('network down'));
    const result = await promise;
    expect(callbacks.onAbort).not.toHaveBeenCalled();
    expect(result.narrationFailed).toBe(true);
  });
});
