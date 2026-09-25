import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../persistence/database.js';
import { createIdeasRouter } from '../../routes/ideasRoutes.js';
import { createTurnRouter } from '../../routes/turnRoutes.js';
import { resetIdeasStateForTests } from '../../services/ideasService.js';
import { acceptSessionOperation } from '../../services/sessionOperationService.js';
import { StateService } from '../../services/stateService.js';
import type { Choice, IdeasPayload, SessionSnapshot } from '../../types.js';
import { resetMockNarrationProvider } from './mockNarrationProvider.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

const mocks = vi.hoisted(() => ({
  runChoicesWithRetry: vi.fn(),
  broadcastUpdate: vi.fn(),
}));

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createMockNarrationProvider } = await import('./mockNarrationProvider.js');
  return {
    createNarrationProvider: vi.fn(() => createMockNarrationProvider()),
    createChatClientForTier: vi.fn(),
  };
});

vi.mock('../../services/dmTurnOrchestrator.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/dmTurnOrchestrator.js')>(),
  runChoicesWithRetry: mocks.runChoicesWithRetry,
}));

vi.mock('../../realtime/sessionEvents.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../realtime/sessionEvents.js')>(),
  broadcastUpdate: mocks.broadcastUpdate,
}));

let paths: IntegrationTestPaths;
let server: Server;
let baseUrl: string;

const IDEAS: Choice[] = [
  { label: 'Sneak past the cook', difficulty: 'normal', stat: 'mischief', difficultyValue: 12 },
  { label: 'Lift the soup pot', difficulty: 'hard', stat: 'might', difficultyValue: 15 },
  { label: 'Charm the kitchen cat', difficulty: 'easy', stat: 'magic', difficultyValue: 8 },
];

const flow = (choices: Choice[] = IDEAS, usedFallback = false) => ({
  choices: { choices },
  initial: null,
  initialIssues: null,
  diagnostics: [],
  escalated: false,
  usedFallback,
});

const post = (path: string, body: Record<string, unknown>) => fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const askIdeas = (sessionId: string, body: Record<string, unknown>) => post(`/session/${sessionId}/ideas`, body);

// A session whose latest turn has no suggestions yet.
const seed = async (id: string): Promise<{ turnId: number; revision: number }> => {
  await insertSessionState(makeTestSession({ id }));
  await StateService.addTurnResult(id, { narration: 'The kitchen bubbles.', choices: [], imagePrompt: null, imageSuggested: false }, null);
  const history = await StateService.getTurnHistory(id);
  return { turnId: history[history.length - 1].id as number, revision: StateService.getRevision(id) ?? 0 };
};

const storedChoices = async (sessionId: string): Promise<Choice[]> => {
  const history = await StateService.getTurnHistory(sessionId);
  return history[history.length - 1].choices;
};

beforeAll(async () => {
  paths = setupIntegrationEnvironment('ideas');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.namespaceId = 'local';
    req.userEmail = null;
    next();
  });
  app.use(createIdeasRouter());
  app.use(createTurnRouter());
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  resetMockNarrationProvider();
  resetIdeasStateForTests();
  mocks.runChoicesWithRetry.mockReset();
  mocks.runChoicesWithRetry.mockResolvedValue(flow());
  mocks.broadcastUpdate.mockReset();
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  cleanupIntegrationEnvironment(paths);
});

describe('POST /session/:id/ideas', () => {
  it('generates ideas for the current turn, stores them, and broadcasts them without a turn', async () => {
    const key = await seed('ideas-basic');
    const res = await askIdeas('ideas-basic', key);

    expect(res.status).toBe(200);
    const payload = await res.json() as IdeasPayload;
    expect(payload).toMatchObject({ turnId: key.turnId, revision: key.revision, characterId: 'char-pip', degraded: false });
    expect(payload.choices.map(c => c.label)).toEqual(IDEAS.map(c => c.label));
    expect(payload.choices.every(c => typeof c.id === 'number')).toBe(true);
    expect((await storedChoices('ideas-basic')).map(c => c.id)).toEqual(payload.choices.map(c => c.id));
    expect(StateService.getRevision('ideas-basic')).toBe(key.revision);
    expect(mocks.broadcastUpdate).toHaveBeenCalledWith('ideas-basic', 'ideas_updated', expect.objectContaining({ turnId: key.turnId, revision: key.revision }));
    expect(mocks.broadcastUpdate.mock.calls.some(call => call[1] === 'turn_complete')).toBe(false);
  });

  it('returns stored ideas for the same key, and runs one generation for concurrent requests', async () => {
    const key = await seed('ideas-dedupe');
    const [a, b] = await Promise.all([askIdeas('ideas-dedupe', key), askIdeas('ideas-dedupe', key)]);
    const again = await askIdeas('ideas-dedupe', key);

    expect([a.status, b.status, again.status]).toEqual([200, 200, 200]);
    expect(mocks.runChoicesWithRetry).toHaveBeenCalledTimes(1);
    expect((await again.json() as IdeasPayload).choices.map(c => c.label)).toEqual(IDEAS.map(c => c.label));
  });

  it('lets an idea be submitted by id, and rejects it once a settings change made it stale', async () => {
    const key = await seed('ideas-submit');
    const { choices } = await (await askIdeas('ideas-submit', key)).json() as IdeasPayload;

    StateService.bumpRevision('ideas-submit');
    const stale = await post('/session/ideas-submit/action', { action: choices[0].label, statUsed: 'mischief', choiceId: choices[0].id, requestId: 'submit-stale' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'stale_choice' });

    // Regenerated for the new revision, the fresh idea is accepted.
    const fresh = await (await askIdeas('ideas-submit', { turnId: key.turnId, revision: key.revision + 1 })).json() as IdeasPayload;
    expect(mocks.runChoicesWithRetry).toHaveBeenCalledTimes(2);
    const accepted = await post('/session/ideas-submit/action', { action: fresh.choices[0].label, statUsed: 'mischief', choiceId: fresh.choices[0].id, requestId: 'submit-fresh' });
    expect(accepted.status).toBe(202);
    await vi.waitFor(async () => {
      expect((await (await fetch(`${baseUrl}/session/ideas-submit/snapshot`)).json() as SessionSnapshot).activeOperation).toBeNull();
    });
  });

  it('rejects a stale turn or revision before generating', async () => {
    const key = await seed('ideas-stale');
    expect((await askIdeas('ideas-stale', { ...key, revision: key.revision + 3 })).status).toBe(409);
    expect((await askIdeas('ideas-stale', { ...key, turnId: key.turnId + 999 })).status).toBe(409);
    expect(mocks.runChoicesWithRetry).not.toHaveBeenCalled();
  });

  it('refuses while an action is resolving, and discards ideas when one is accepted mid-generation', async () => {
    const key = await seed('ideas-busy');
    let release: (value: unknown) => void = () => {};
    mocks.runChoicesWithRetry.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve(flow());
    }));

    const pending = askIdeas('ideas-busy', key);
    await vi.waitFor(() => expect(mocks.runChoicesWithRetry).toHaveBeenCalled());
    const accepted = acceptSessionOperation({ sessionId: 'ideas-busy', namespaceId: 'local', kind: 'action', payload: { action: 'x' } });
    expect(accepted.type).toBe('accepted');
    release(null);

    const res = await pending;
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'stale_ideas' });
    expect(await storedChoices('ideas-busy')).toEqual([]);

    const busy = await askIdeas('ideas-busy', key);
    expect(await busy.json()).toMatchObject({ error: 'operation_in_progress' });
  });

  it('stores fallback ideas as degraded, and allows one try-again', async () => {
    const key = await seed('ideas-degraded');
    mocks.runChoicesWithRetry.mockResolvedValueOnce(flow(IDEAS, true));

    expect(await (await askIdeas('ideas-degraded', key)).json()).toMatchObject({ degraded: true });
    expect(await (await askIdeas('ideas-degraded', key)).json()).toMatchObject({ degraded: true });
    expect(mocks.runChoicesWithRetry).toHaveBeenCalledTimes(1);

    expect(await (await askIdeas('ideas-degraded', { ...key, retry: true })).json()).toMatchObject({ degraded: false });
    expect(mocks.runChoicesWithRetry).toHaveBeenCalledTimes(2);
  });

  it('stores nothing when even the fallback produced no ideas', async () => {
    const key = await seed('ideas-empty');
    mocks.runChoicesWithRetry.mockResolvedValueOnce(flow([], true));

    const res = await askIdeas('ideas-empty', key);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'ideas_unavailable' });
    expect(await storedChoices('ideas-empty')).toEqual([]);
  });

  it('refuses ideas once the campaign is over', async () => {
    const key = await seed('ideas-over');
    getDb().prepare('UPDATE sessions SET game_over = 1 WHERE id = ?').run('ideas-over');
    expect(await (await askIdeas('ideas-over', key)).json()).toMatchObject({ error: 'game_over' });
  });

  it('never sends riddle correctness in the payload or the event', async () => {
    const key = await seed('ideas-riddle');
    mocks.runChoicesWithRetry.mockResolvedValueOnce(flow([
      { label: 'Answer: a river', difficulty: 'normal', stat: 'magic', riddleAnswer: 'a river', riddleCorrect: true },
      ...IDEAS.slice(0, 2),
    ]));

    const text = await (await askIdeas('ideas-riddle', key)).text();
    expect(text).not.toMatch(/riddleAnswer|riddleCorrect/);
    expect(JSON.stringify(mocks.broadcastUpdate.mock.calls)).not.toMatch(/riddleAnswer|riddleCorrect/);
  });

  it('asks once by itself in onboarding, never elsewhere', async () => {
    const key = await seed('ideas-onboarding');
    getDb().prepare("UPDATE sessions SET onboarding_ideas = 'pending' WHERE id = ?").run('ideas-onboarding');

    expect((await askIdeas('ideas-onboarding', { ...key, reason: 'onboarding_auto' })).status).toBe(200);
    expect(await (await askIdeas('ideas-onboarding', { ...key, reason: 'onboarding_auto' })).json()).toMatchObject({ error: 'already_requested' });
    expect((await StateService.getSession('ideas-onboarding'))?.onboardingIdeasPending).toBeUndefined();

    const other = await seed('ideas-not-onboarding');
    expect(await (await askIdeas('ideas-not-onboarding', { ...other, reason: 'onboarding_auto' })).json()).toMatchObject({ error: 'already_requested' });
  });

  it('limits how many generations one session can run per minute', async () => {
    const key = await seed('ideas-rate');
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await askIdeas('ideas-rate', { turnId: key.turnId, revision: StateService.getRevision('ideas-rate') ?? 0 })).status);
      StateService.bumpRevision('ideas-rate');
    }
    expect(statuses.slice(0, 6)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(statuses[6]).toBe(429);
  });
});
