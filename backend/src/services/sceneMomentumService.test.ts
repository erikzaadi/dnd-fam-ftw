import { describe, expect, it } from 'vitest';
import type { ActionAttempt, SessionState, TurnResult } from '../types.js';
import { buildSceneMomentum, buildScenePressure, turnPressureKind } from './sceneMomentumService.js';

const makeSession = (overrides: Partial<SessionState> = {}): SessionState => ({
  id: 'session-1',
  scene: 'A ruined tower',
  sceneId: 'tower-1',
  turn: 4,
  party: [],
  activeCharacterId: '',
  displayName: 'Momentum Test',
  savingsMode: false,
  interventionState: { rescuesUsed: 0 },
  npcs: [],
  quests: [],
  lastChoices: [],
  tone: 'thrilling',
  recentHistory: [],
  difficulty: 'normal',
  gameMode: 'fast',
  storySummary: '',
  ...overrides,
});

const action = (actionAttempt: string, success = true, difficultyTarget = 12): ActionAttempt => ({
  actionAttempt,
  actionResult: {
    success,
    roll: success ? 15 : 4,
    statUsed: 'might',
    difficultyTarget,
  },
});

const turn = (overrides: Partial<TurnResult> = {}): TurnResult => ({
  narration: 'A wolf attacks from the broken stair.',
  choices: [
    { label: 'Strike the wolf', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
    { label: 'Dodge the wolf', difficulty: 'normal', stat: 'mischief', difficultyValue: 12 },
    { label: 'Blast the wolf', difficulty: 'normal', stat: 'magic', difficultyValue: 12 },
  ],
  imagePrompt: null,
  imageSuggested: false,
  currentTensionLevel: 'high',
  lastAction: action('Strike the wolf', true),
  ...overrides,
});

describe('scene momentum', () => {
  it('marks the second successful combat pressure turn as a victory exit', () => {
    const history = [turn()];
    const currentAction = action('Force the last wolf back');
    const pressure = buildScenePressure(history, currentAction, 'The wolf fight fills the tower stair.');
    const momentum = buildSceneMomentum(history, currentAction, makeSession(), pressure);

    expect(pressure.kind).toBe('combat');
    expect(pressure.successfulPressureTurns).toBeGreaterThanOrEqual(2);
    expect(momentum.directive).toBe('victory_exit');
    expect(momentum.justCompletedCombat).toBe(true);
    expect(momentum.suggestedNextBeat).toContain('next');
  });

  it('closes combat after the first successful combat pressure turn', () => {
    const currentAction = action('Strike the wolf');
    const pressure = buildScenePressure([], currentAction, 'The wolf fight fills the tower stair.');
    const momentum = buildSceneMomentum([], currentAction, makeSession(), pressure);

    expect(momentum.directive).toBe('close_combat');
    expect(momentum.justCompletedCombat).toBe(false);
  });

  it('advances fast mode when choices are stale', () => {
    const currentAction = action('Look around');
    const session = makeSession({
      lastChoices: [
        { label: 'Search the room', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
        { label: 'Inspect the room', difficulty: 'easy', stat: 'magic', difficultyValue: 8 },
        { label: 'Wait and listen', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
      ],
    });
    const pressure = buildScenePressure([], currentAction, 'A quiet hallway');
    const momentum = buildSceneMomentum([], currentAction, session, pressure);

    expect(momentum.staleChoiceCount).toBeGreaterThanOrEqual(2);
    expect(momentum.directive).toBe('advance_campaign');
  });

  it('treats a successful difficult challenge as a victory exit', () => {
    const currentAction = action('Disarm the collapsing rune bridge', true, 15);
    const pressure = buildScenePressure([], currentAction, 'A rune bridge challenge blocks the road.');
    const momentum = buildSceneMomentum([], currentAction, makeSession(), pressure);

    expect(pressure.kind).toBe('challenge');
    expect(momentum.directive).toBe('victory_exit');
    expect(momentum.justCompletedDifficultChallenge).toBe(true);
  });

  it('does not mark a non-pressure action as victory exit just because recent turns were tense', () => {
    const history = [
      turn({
        narration: 'A shadow hangs over the village after the Beacon theft.',
        choices: [
          { label: 'Scout the woods', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
          { label: 'Question Finnian', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
          { label: 'Consult the mayor', difficulty: 'normal', stat: 'magic', difficultyValue: 11 },
        ],
        lastAction: action('Scout the village for clues', true, 10),
      }),
      turn({
        narration: 'The hidden path leads to a cliff route under Lady Umbra\'s shadow.',
        choices: [
          { label: 'Study the cliff path', difficulty: 'normal', stat: 'magic', difficultyValue: 12 },
          { label: 'Search for Beacon clues', difficulty: 'normal', stat: 'mischief', difficultyValue: 12 },
          { label: 'Ask about Lady Umbra', difficulty: 'normal', stat: 'magic', difficultyValue: 12 },
        ],
        lastAction: action('Scout the woods for signs of the Beacon', true, 11),
      }),
    ];
    const currentAction = action('Charge down the narrow path, seeking out Lady Umbra\'s lair', true, 12);
    const pressure = buildScenePressure(history, currentAction, 'A cliff path');
    const momentum = buildSceneMomentum(history, currentAction, makeSession({ scene: 'A cliff path' }), pressure);

    expect(pressure.kind).toBe('challenge');
    expect(momentum.justCompletedCombat).toBe(false);
    expect(momentum.justCompletedDifficultChallenge).toBe(false);
    expect(momentum.directive).not.toBe('victory_exit');
  });

  it('does not count a successful regroup action as another combat hit', () => {
    const history = [
      turn({
        narration: 'The Shadowkin snarl from the mist.',
        choices: [
          { label: 'Strike the Shadowkin', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
          { label: 'Bind them with vines', difficulty: 'normal', stat: 'magic', difficultyValue: 12 },
          { label: 'Find better footing', difficulty: 'normal', stat: 'mischief', difficultyValue: 12 },
        ],
        lastAction: action('Strike the Shadowkin', true, 12),
      }),
    ];
    const currentAction = action('Regroup and heal before proceeding', true, 12);
    const pressure = buildScenePressure(history, currentAction, 'Misty Glade');
    const momentum = buildSceneMomentum(history, currentAction, makeSession({ scene: 'Misty Glade' }), pressure);

    expect(pressure.kind).toBe('combat');
    expect(pressure.successfulPressureTurns).toBe(1);
    expect(momentum.directive).not.toBe('victory_exit');
  });

  it('treats resolved combat turns as calm so victories do not reopen the same fight', () => {
    const resolvedTurn = turn({
      narration: 'With the last of the Shadowkin defeated, a radiant path opens ahead.',
      choices: [
        { label: 'Venture down the shimmering path', difficulty: 'normal', stat: 'mischief', difficultyValue: 12 },
        { label: 'Consult the glade magic', difficulty: 'normal', stat: 'magic', difficultyValue: 12 },
        { label: 'Prepare for the next chamber', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
      ],
      lastAction: action('Rally Pundemic to strike the Shadowkin', true, 12),
    });
    const currentAction = action('Venture down the shimmering path', false, 12);
    const pressure = buildScenePressure([resolvedTurn], currentAction, 'Misty Glade');

    expect(turnPressureKind(resolvedTurn)).toBe('calm');
    expect(pressure.kind).toBe('calm');
    expect(pressure.successfulPressureTurns).toBe(0);
  });
});
