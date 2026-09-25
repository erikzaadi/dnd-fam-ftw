import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestIdeas, resetIdeasStateForTests } from '../../services/ideasService.js';
import { StateService } from '../../services/stateService.js';
import { executeTurnAction } from '../../services/turnService.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

// Freeform turns end to end through the real test provider (TEST_AI_MOCK), which behaves
// like the orchestrator (see dmTurnOrchestrator.test.ts for the real agents): turns carry
// no suggestions, and ideas come on request.

let paths: IntegrationTestPaths;
const STRATEGIES = ['parallel', 'resolved_first'] as const;

beforeAll(() => {
  paths = setupIntegrationEnvironment('ideas-on-request');
  process.env.TEST_AI_MOCK = 'true';
});

beforeEach(() => {
  resetIdeasStateForTests();
});

afterEach(() => {
  delete process.env.AI_TURN_STRATEGY;
  vi.restoreAllMocks();
});

afterAll(() => {
  delete process.env.TEST_AI_MOCK;
  cleanupIntegrationEnvironment(paths);
});

const latestTurn = async (sessionId: string) => {
  const history = await StateService.getTurnHistory(sessionId);
  return history[history.length - 1];
};

describe.each(STRATEGIES)('turn pipeline %s', (strategy) => {
  beforeEach(() => {
    process.env.AI_TURN_STRATEGY = strategy;
  });

  it('turns arrive without suggestions, ideas come on request, and an idea can be played', async () => {
    const id = `cod-on-${strategy}`;
    await insertSessionState(makeTestSession({ id }));
    const first = await executeTurnAction(id, 'local', { action: 'Pip sneaks past the cook', statUsed: 'mischief' });
    expect(first.ok).toBe(true);
    const turn = await latestTurn(id);
    expect(turn.choices).toEqual([]);
    expect((await StateService.getSession(id))?.lastChoices).toEqual([]);

    const ideas = await requestIdeas(id, { turnId: turn.id as number, revision: StateService.getRevision(id) ?? 0 });
    expect(ideas.ok).toBe(true);
    if (!ideas.ok) {
      return;
    }
    expect(ideas.payload.choices).toHaveLength(3);
    expect(ideas.payload.degraded).toBe(false);

    const idea = ideas.payload.choices[1];
    const played = await executeTurnAction(id, 'local', { action: idea.label, statUsed: idea.stat, choiceId: idea.id });
    expect(played.ok).toBe(true);
    expect(played.ok && played.body.actionAttempt.actionAttempt).toBe(idea.label);
    expect((await latestTurn(id)).choices).toEqual([]);
  });
});
