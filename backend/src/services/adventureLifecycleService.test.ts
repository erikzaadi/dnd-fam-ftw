import { describe, expect, it } from 'vitest';
import type { AdventureProgress, SessionState } from '../types.js';
import {
  advanceArcAfterTurn,
  buildAdventureDirective,
  buildAdventureProgress,
  changeAdventureFormat,
  computePacingTargets,
  createInitialArc,
  requestWrapUp,
  type ArcTurnFacts,
} from './adventureLifecycleService.js';

const evening = (overrides: Partial<AdventureProgress> = {}): AdventureProgress => ({
  ...buildAdventureProgress({ format: 'one_evening', status: 'active', arc: createInitialArc(), objective: 'Rescue the baker', partySize: 2 }),
  ...overrides,
});

const facts = (overrides: Partial<ArcTurnFacts> = {}): ArcTurnFacts => ({
  countsAsPlayerAction: true,
  actingCharacterId: 'a',
  partySize: 2,
  rollSucceeded: true,
  objectiveOutcome: null,
  encounterResolvedThisTurn: false,
  partyWiped: false,
  ...overrides,
});

const playTurns = (start: AdventureProgress, count: number, turnFacts: Partial<ArcTurnFacts> = {}): AdventureProgress => {
  let progress = start;
  for (let i = 0; i < count; i++) {
    progress = advanceArcAfterTurn(progress, facts(turnFacts)).progress;
  }
  return progress;
};

const session = (adventure: AdventureProgress): SessionState => ({
  id: 's', scene: 'Bakery', sceneId: 'b', turn: 1, party: [
    { id: 'a', name: 'Pip', class: 'Rogue', species: 'Halfling', quirk: '', hp: 5, max_hp: 5, status: 'active', stats: { might: 1, magic: 1, mischief: 3 }, inventory: [] },
    { id: 'b', name: 'Zara', class: 'Wizard', species: 'Elf', quirk: '', hp: 5, max_hp: 5, status: 'active', stats: { might: 1, magic: 3, mischief: 1 }, inventory: [] },
  ],
  activeCharacterId: 'a', npcs: [], quests: [], lastChoices: [], tone: '', recentHistory: [], displayName: 'Realm',
  difficulty: 'normal', savingsMode: true, interventionState: { rescuesUsed: 0 }, storySummary: '', adventure,
});

describe('pacing targets', () => {
  it('scales with party size and starts from the budget point', () => {
    expect(computePacingTargets(2, 0)).toEqual({ developmentAt: 3, finaleAt: 8, resolveBy: 12 });
    expect(computePacingTargets(5, 0)).toEqual({ developmentAt: 5, finaleAt: 10, resolveBy: 15 });
    expect(computePacingTargets(2, 6).finaleAt).toBe(14);
  });
});

describe('advanceArcAfterTurn', () => {
  it('moves opening -> development -> finale on committed player actions only', () => {
    expect(playTurns(evening(), 3).phase).toBe('development');
    const finale = playTurns(evening(), 8);
    expect(finale.phase).toBe('finale');
    expect(finale.finaleStartedAtCount).toBe(8);
    // Non-player turns (initial, rescue) never count.
    expect(advanceArcAfterTurn(evening(), facts({ countsAsPlayerAction: false })).progress.playerActionCount).toBe(0);
  });

  it('never resolves on the finale setup turn, and needs committed facts afterwards', () => {
    const finale = playTurns(evening(), 8);
    const setup = advanceArcAfterTurn(finale, facts({ objectiveOutcome: 'resolved_success' }));
    expect(setup.resolution).toBeUndefined();

    const failedClaim = advanceArcAfterTurn(setup.progress, facts({ rollSucceeded: false, objectiveOutcome: 'resolved_success' }));
    expect(failedClaim.resolution).toBeUndefined();
    expect(failedClaim.progress.decisiveAttempts).toBe(1);

    const won = advanceArcAfterTurn(failedClaim.progress, facts({ rollSucceeded: true, objectiveOutcome: 'resolved_success' }));
    expect(won.resolution).toBe('success');
    expect(won.progress).toMatchObject({ status: 'concluding', phase: 'epilogue' });
  });

  it('accepts a setback ending only after an earlier failed attempt', () => {
    const decisive = advanceArcAfterTurn(playTurns(evening(), 8), facts()).progress;
    const firstFail = advanceArcAfterTurn(decisive, facts({ rollSucceeded: false, objectiveOutcome: 'resolved_setback' }));
    expect(firstFail.resolution).toBeUndefined();
    const secondFail = advanceArcAfterTurn(firstFail.progress, facts({ rollSucceeded: false, objectiveOutcome: 'resolved_setback' }));
    expect(secondFail.resolution).toBe('setback');
  });

  it('treats a finale encounter resolved with silent narration as success', () => {
    const decisive = advanceArcAfterTurn(playTurns(evening(), 8), facts()).progress;
    expect(advanceArcAfterTurn(decisive, facts({ encounterResolvedThisTurn: true })).resolution).toBe('success');
  });

  it('never resolves on a party wipe', () => {
    const decisive = advanceArcAfterTurn(playTurns(evening(), 8), facts()).progress;
    expect(advanceArcAfterTurn(decisive, facts({ partyWiped: true, objectiveOutcome: 'resolved_success' })).resolution).toBeUndefined();
  });

  it('offers keep-going or end-here instead of looping forever', () => {
    const overtime = playTurns(evening(), 14, { rollSucceeded: false });
    expect(overtime.status).toBe('active');
    expect(overtime.continueOffered).toBe(true);
  });

  it('applies no ending pressure to long-lived sessions', () => {
    const longLived = playTurns(evening({ format: 'long_lived' }), 30);
    expect(longLived.phase).toBe('development');
    expect(longLived.status).toBe('active');
    expect(buildAdventureDirective(session(longLived))).toBeUndefined();
  });
});

describe('wrap up and format changes', () => {
  it('wrap-up requests a finale without inventing an outcome, even when long-lived', () => {
    const wrapped = requestWrapUp(playTurns(evening({ format: 'long_lived' }), 5));
    expect(wrapped).toMatchObject({ wrapUpRequested: true, phase: 'finale', finaleStartedAtCount: 5, status: 'active' });
    expect(buildAdventureDirective(session(wrapped))?.decisiveMoment).toBe(false);
    const next = advanceArcAfterTurn(wrapped, facts()).progress;
    expect(buildAdventureDirective(session(next))?.decisiveMoment).toBe(true);
  });

  it('switching back to one evening starts a fresh budget from the current point', () => {
    const longLived = playTurns(evening({ format: 'long_lived' }), 20);
    const evening2 = changeAdventureFormat(longLived, 'one_evening');
    expect(evening2.budgetStartCount).toBe(20);
    expect(advanceArcAfterTurn(evening2, facts()).progress.phase).not.toBe('finale');
  });
});

describe('buildAdventureDirective', () => {
  it('names heroes who have not had a moment yet and includes the private payoff', () => {
    const directive = buildAdventureDirective({ ...session(playTurns(evening(), 3)), adventurePlan: 'The key opens the oven vault' });
    expect(directive?.heroesAwaitingSpotlight).toEqual(['Zara']);
    expect(directive?.chapterPayoff).toBe('The key opens the oven vault');
    expect(directive?.instruction).not.toContain('oven vault');
  });
});
