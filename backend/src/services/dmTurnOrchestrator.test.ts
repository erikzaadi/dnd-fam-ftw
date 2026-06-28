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
    // Choices agent throws on both the first attempt and the retry
    mocks.stream.mockReturnValueOnce({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('choices failure')),
    });
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

  it('strips em dashes from narration and choices even when the model ignores the prompt rule', async () => {
    mockStreamOnce(makeNarrationCompletion('The gate creaks open—revealing a hall of mirrors.', 'A clean hit—right on target.'));
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

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    expect(result.narration).toBe('The gate creaks open-revealing a hall of mirrors.');
    expect(result.rollNarration).toBe('A clean hit-right on target.');
    expect(result.choices[0].label).toBe('Step through-carefully');
    expect(result.choices[0].narration).toBe('One step at a time-no sudden moves.');
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
    mockStreamOnce(makeChoicesCompletion());

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
    mockStreamOnce(makeChoicesCompletion());

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    expect(result.narration).toBeTruthy();
    expect(result.narrationFailed).toBe(true);
    expect(result.choices).toHaveLength(3);
  });

  it('narration agent malformed stream (no parsed output) triggers fallback', async () => {
    mockStreamOnce({
      choices: [{ finish_reason: 'length', message: { refusal: null, parsed: null } }],
    });
    mockStreamOnce(makeChoicesCompletion());

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    expect(result.narration).toBeTruthy();
    expect(result.narrationFailed).toBe(true);
  });

  it('choices agent malformed stream triggers fallback choices and choicesFailed', async () => {
    mockStreamOnce(makeNarrationCompletion('Onward.'));
    mockStreamOnce({
      choices: [{ finish_reason: 'stop', message: { refusal: null, parsed: null } }],
    });
    // The retry attempt also fails (malformed again)
    mockStreamOnce({
      choices: [{ finish_reason: 'stop', message: { refusal: null, parsed: null } }],
    });

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(baseInput());

    expect(result.choices).toHaveLength(3);
    expect(result.choicesFailed).toBe(true);
    expect(result.narration).toBe('Onward.');
  });

  it('choices agent timeout retries once and uses the retry output', async () => {
    vi.useFakeTimers();
    try {
      mockStreamOnce(makeNarrationCompletion('Onward.'));
      // First choices attempt hangs past its deadline
      mocks.stream.mockReturnValueOnce({
        on: vi.fn(),
        finalChatCompletion: vi.fn(() => new Promise(() => {})),
      });
      // Retry succeeds
      mockStreamOnce(makeChoicesCompletion());

      const orchestrator = new DmTurnOrchestrator();
      const promise = orchestrator.orchestrate(baseInput());
      await vi.advanceTimersByTimeAsync(3600);
      const result = await promise;

      expect(result.choices).toHaveLength(3);
      expect(result.choices[0].label).toBe('Press deeper');
      expect(result.choicesFailed).toBe(false);
      const firstDiag = result.agentDiagnostics.find(d => d.agent === 'choices');
      const retryDiag = result.agentDiagnostics.find(d => d.agent === 'choices-retry');
      expect(firstDiag?.status).toBe('timeout');
      expect(retryDiag?.status).toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries when choices agent returns the same labels as previousChoiceLabels', async () => {
    const previousLabels = ['Press deeper', 'Press deeper', 'Press deeper'];
    const input = { ...baseInput(), previousChoiceLabels: previousLabels, nextCharacterName: 'Pip' };
    mockStreamOnce(makeNarrationCompletion('Onward.'));
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

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(input);

    expect(result.choices[0].label).toBe('Smash through the barrier');
    expect(result.choicesFailed).toBe(false);
    const staleDiag = result.agentDiagnostics.find(d => d.agent === 'choices-stale-retry');
    expect(staleDiag?.status).toBe('ok');
  });

  it('uses stale choices as fallback and applies ensureTopStatCoverage when stale retry also fails', async () => {
    const previousLabels = ['Press deeper', 'Press deeper', 'Press deeper'];
    const input = { ...baseInput(), previousChoiceLabels: previousLabels, nextCharacterName: 'Pip' };
    mockStreamOnce(makeNarrationCompletion('Onward.'));
    // First attempt: stale
    mockStreamOnce(makeChoicesCompletion());
    // Stale retry fails
    mocks.stream.mockReturnValueOnce({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('retry failure')),
    });

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(input);

    // Falls back to the stale choices with ensureTopStatCoverage applied
    // Pip's top stat is mischief (4); 'Press deeper' uses might, so one slot is replaced
    expect(result.choices).toHaveLength(3);
    expect(result.choices.some(c => c.stat === 'mischief')).toBe(true);
    expect(result.choicesFailed).toBe(false);
  });

  it('retries choices on the stronger model when no choice uses the next hero top stat', async () => {
    // Pip's top stat is mischief (4); the fixture choices are all might
    const input = { ...baseInput(), nextCharacterName: 'Pip' };
    mockStreamOnce(makeNarrationCompletion('Onward.'));
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

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(input);

    expect(result.choices.some(c => c.stat === 'mischief')).toBe(true);
    expect(result.choicesFailed).toBe(false);
    expect(result.agentDiagnostics.find(d => d.agent === 'choices-coverage-retry')?.status).toBe('ok');
  });

  it('injects top-stat fallback when the coverage retry fails', async () => {
    const input = { ...baseInput(), nextCharacterName: 'Pip' };
    mockStreamOnce(makeNarrationCompletion('Onward.'));
    // All choices use might; Pip's top stat is mischief
    mockStreamOnce(makeChoicesCompletion());
    // Coverage retry fails
    mocks.stream.mockReturnValueOnce({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('retry failure')),
    });

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(input);

    expect(result.choices).toHaveLength(3);
    // The weakest-stat (might) choice at index 0 is replaced with the mischief fallback
    expect(result.choices.some(c => c.stat === 'mischief')).toBe(true);
    expect(result.choicesFailed).toBe(false);
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
      // Narration deadline 6000ms; choices 3500ms + 3000ms retry = 6500ms
      await vi.advanceTimersByTimeAsync(6600);
      const result = await promise;

      expect(result.narrationFailed).toBe(true);
      expect(result.choicesFailed).toBe(true);
      expect(result.choices).toHaveLength(3);
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
    expect(result.choices).toHaveLength(3);
    expect(result.narrationFailed).toBe(true);
    expect(result.choicesFailed).toBe(true);
    expect(result.currentTensionLevel).toBeTruthy();
    expect(result.suggestedDamage).toBeNull();
    expect(result.suggestedInventoryAdd).toBeNull();
  });

  it('inventory agent retries once on parse error and uses the retry output', async () => {
    const input: NarrationInput = { ...baseInput(), actionAttempt: 'Trade the sword for a lantern' };

    mockStreamOnce(makeNarrationCompletion('The trade is struck.'));
    mockStreamOnce(makeChoicesCompletion());
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

    expect(mocks.stream).toHaveBeenCalledTimes(4);
    expect(result.suggestedInventoryAdd?.name).toBe('🏮 Brass Lantern');
    const inventoryDiag = result.agentDiagnostics.find(d => d.agent === 'inventory');
    expect(inventoryDiag?.status).toBe('retry');
  });

  it('inventory agent falls back after exactly one failed retry', async () => {
    const input: NarrationInput = { ...baseInput(), actionAttempt: 'Trade the sword for a lantern' };

    mockStreamOnce(makeNarrationCompletion('The trade is struck.'));
    mockStreamOnce(makeChoicesCompletion());
    // Both inventory attempts malformed -> fallback, no third attempt
    mockStreamOnce({ choices: [{ finish_reason: 'stop', message: { refusal: null, parsed: null } }] });
    mockStreamOnce({ choices: [{ finish_reason: 'stop', message: { refusal: null, parsed: null } }] });

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.orchestrate(input);

    expect(mocks.stream).toHaveBeenCalledTimes(4);
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
    mockStreamOnce(makeChoicesCompletion());
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
      mockStreamOnce(makeChoicesCompletion());
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

describe('DmTurnOrchestrator.rerunChoices', () => {
  it('returns fresh choices when the choices agent succeeds', async () => {
    mockStreamOnce(makeChoicesCompletion());

    const orchestrator = new DmTurnOrchestrator();
    const choices = await orchestrator.rerunChoices(baseInput());

    expect(choices).toHaveLength(3);
    expect(choices?.[0].label).toBe('Press deeper');
  });

  it('returns null when the choices agent fails, leaving the caller on fallback choices', async () => {
    mocks.stream.mockReturnValueOnce({
      on: vi.fn(),
      finalChatCompletion: vi.fn().mockRejectedValue(new Error('rerun failure')),
    });

    const orchestrator = new DmTurnOrchestrator();
    const choices = await orchestrator.rerunChoices(baseInput());

    expect(choices).toBeNull();
  });
});

describe('DmTurnOrchestrator as NarrationProvider', () => {
  it('generateTurn delegates to orchestrate', async () => {
    mockStreamOnce(makeNarrationCompletion('Through the factory seam.'));
    mockStreamOnce(makeChoicesCompletion());

    const orchestrator = new DmTurnOrchestrator();
    const result = await orchestrator.generateTurn(baseInput());

    expect(result.narration).toBe('Through the factory seam.');
    expect(result.choices).toHaveLength(3);
  });
});
