import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../persistence/database.js';
import { createAdventureRouter } from '../../routes/adventureRoutes.js';
import { createTurnRouter } from '../../routes/turnRoutes.js';
import { createSessionRouter } from '../../routes/sessionRoutes.js';
import { GameEngine } from '../../services/gameEngine.js';
import { StateService } from '../../services/stateService.js';
import { createInitialArc, serializeArc } from '../../services/adventureLifecycleService.js';
import type { AdventureArcState, SessionSnapshot } from '../../types.js';
import { FIXED_NARRATION_OUTPUT, mockGenerateTurn, resetMockNarrationProvider } from './mockNarrationProvider.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createMockNarrationProvider } = await import('./mockNarrationProvider.js');
  return {
    createNarrationProvider: vi.fn(() => createMockNarrationProvider()),
    // No chat client: the epilogue falls back to the deterministic ending.
    createChatClientForTier: vi.fn(() => {
      throw new Error('no provider in tests');
    }),
  };
});

let paths: IntegrationTestPaths;
let server: Server;
let baseUrl: string;

const setAdventure = (sessionId: string, format: 'one_evening' | 'long_lived', arc: Partial<AdventureArcState>, objective = 'Rescue the lost baker') => {
  getDb().prepare('UPDATE sessions SET adventure_format = ?, adventure_status = ?, adventure_arc = ?, adventure_objective = ?, adventure_plan = ? WHERE id = ?')
    .run(format, 'active', serializeArc({ ...createInitialArc(), ...arc }), objective, 'SECRET: the baker is the villain', sessionId);
};

const post = (path: string, body: Record<string, unknown>) => fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const snapshot = async (sessionId: string) => (await fetch(`${baseUrl}/session/${sessionId}/snapshot`)).json() as Promise<SessionSnapshot>;

const waitIdle = (sessionId: string) => vi.waitFor(async () => {
  expect((await snapshot(sessionId)).activeOperation).toBeNull();
});

const successfulRoll = () => vi.spyOn(GameEngine, 'rollDice').mockReturnValue({ roll: 18, total: 22 });

beforeAll(async () => {
  paths = setupIntegrationEnvironment('adventure-lifecycle');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.namespaceId = 'local';
    req.userEmail = null;
    next();
  });
  app.use(createSessionRouter());
  app.use(createTurnRouter());
  app.use(createAdventureRouter());
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  vi.restoreAllMocks();
  resetMockNarrationProvider();
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  cleanupIntegrationEnvironment(paths);
});

describe('one-evening lifecycle (E1/E2)', () => {
  it('resolves a validated finale into a persisted ending with no choices and no hidden prep', async () => {
    await insertSessionState(makeTestSession({ id: 'evening-finale' }));
    // Finale was set up on the previous turn: this action is the decisive attempt.
    setAdventure('evening-finale', 'one_evening', { phase: 'finale', playerActionCount: 9, finaleStartedAtCount: 8, participatingHeroIds: ['char-pip', 'char-zara'] });
    mockGenerateTurn.mockResolvedValueOnce({ ...FIXED_NARRATION_OUTPUT, objectiveOutcome: 'resolved_success' });
    successfulRoll();

    const res = await post('/session/evening-finale/action', { action: 'Free the baker', statUsed: 'might', requestId: 'finale-1', expectedRevision: 0 });
    expect(res.status).toBe(202);
    await waitIdle('evening-finale');

    const snap = await snapshot('evening-finale');
    expect(snap.session.adventure).toMatchObject({ status: 'completed', phase: 'epilogue', resolution: 'success' });
    expect(snap.latestOperation).toMatchObject({ status: 'completed', kind: 'action' });
    const conclusion = snap.history[snap.history.length - 1];
    expect(conclusion.turnType).toBe('conclusion');
    expect(conclusion.choices).toEqual([]);
    expect(snap.session.adventure?.conclusionTurnId).toBe(conclusion.id);
    expect(conclusion.narration).toContain('Pip');
    expect(conclusion.narration).toContain('Zara');
    expect(conclusion.narration).not.toContain('SECRET');
    expect(JSON.stringify(snap.session)).not.toContain('SECRET');

    // Completed adventures reject stale gameplay submissions.
    const stale = await post('/session/evening-finale/action', { action: 'Keep fighting', statUsed: 'might', requestId: 'after-end' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'adventure_completed' });
  });

  it('ignores an unearned victory claim on a failed roll', async () => {
    await insertSessionState(makeTestSession({ id: 'evening-unearned' }));
    setAdventure('evening-unearned', 'one_evening', { phase: 'finale', playerActionCount: 9, finaleStartedAtCount: 8 });
    mockGenerateTurn.mockResolvedValueOnce({ ...FIXED_NARRATION_OUTPUT, objectiveOutcome: 'resolved_success' });
    vi.spyOn(GameEngine, 'rollDice').mockReturnValue({ roll: 2, total: 4 });

    await post('/session/evening-unearned/action', { action: 'Free the baker', statUsed: 'might', requestId: 'fail-1' });
    await waitIdle('evening-unearned');
    const snap = await snapshot('evening-unearned');
    expect(snap.session.adventure).toMatchObject({ status: 'active', phase: 'finale', decisiveAttempts: 1 });
  });

  it('never auto-completes a long-lived session', async () => {
    await insertSessionState(makeTestSession({ id: 'long-lived' }));
    setAdventure('long-lived', 'long_lived', { phase: 'development', playerActionCount: 40 });
    mockGenerateTurn.mockResolvedValue({ ...FIXED_NARRATION_OUTPUT, objectiveOutcome: 'resolved_success' });
    successfulRoll();
    for (const requestId of ['l1', 'l2', 'l3']) {
      await post('/session/long-lived/action', { action: 'Explore', statUsed: 'might', requestId });
      await waitIdle('long-lived');
    }
    expect((await snapshot('long-lived')).session.adventure).toMatchObject({ status: 'active', phase: 'development', playerActionCount: 43 });
  });

  it('ends early with an epilogue without rolling, then continues the world as a new chapter', async () => {
    await insertSessionState(makeTestSession({ id: 'end-here' }));
    setAdventure('end-here', 'one_evening', { phase: 'development', playerActionCount: 4 });
    const before = await StateService.getSession('end-here');

    const end = await post('/session/end-here/adventure/end', { requestId: 'end-1' });
    expect(end.status).toBe(202);
    await waitIdle('end-here');
    const ended = await snapshot('end-here');
    expect(ended.session.adventure).toMatchObject({ status: 'completed', resolution: 'ended_early' });
    expect(ended.session.activeCharacterId).toBe(before?.activeCharacterId);
    expect(mockGenerateTurn).not.toHaveBeenCalled();

    // Replaying the same request never writes a second epilogue.
    const replay = await post('/session/end-here/adventure/end', { requestId: 'end-1' });
    expect(replay.status).toBe(200);
    expect((await snapshot('end-here')).history.filter(t => t.turnType === 'conclusion')).toHaveLength(1);

    const cont = await post('/session/end-here/adventure/continue', { requestId: 'cont-1', adventureFormat: 'long_lived' });
    expect(cont.status).toBe(202);
    await waitIdle('end-here');
    const next = await snapshot('end-here');
    expect(next.session.adventure).toMatchObject({ status: 'active', format: 'long_lived', chapter: 2, playerActionCount: 0 });
    expect(next.session.adventure?.objective).toBeUndefined();
    expect(next.history.map(t => t.turnType)).toEqual(['conclusion', 'chapter_start']);
  });

  it('wrap-up requests a finale without spending a turn, and settings patches are guarded', async () => {
    await insertSessionState(makeTestSession({ id: 'wrap-up' }));
    setAdventure('wrap-up', 'long_lived', { phase: 'development', playerActionCount: 5 });
    const res = await post('/session/wrap-up/adventure/wrap-up', {});
    expect(res.status).toBe(200);
    const snap = await snapshot('wrap-up');
    expect(snap.session.adventure).toMatchObject({ wrapUpRequested: true, phase: 'finale', finaleStartedAtCount: 5, status: 'active' });
    expect(snap.history).toHaveLength(0);
    expect(snap.revision).toBe(1);
  });

  it('new sessions default to one evening while migrated rows stay long-lived', async () => {
    const created = await StateService.createSession('A realm', 'normal', true, 'local', 'balanced', undefined, 'New Realm');
    expect(created.adventure?.format).toBe('one_evening');
    await insertSessionState(makeTestSession({ id: 'legacy-row' }));
    expect((await StateService.getSession('legacy-row'))?.adventure?.format).toBe('long_lived');
  });
});
