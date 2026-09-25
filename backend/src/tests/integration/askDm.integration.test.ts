import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAskRouter } from '../../routes/askRoutes.js';
import { RIDDLE_SAFE_ANSWER, resetAskDmStateForTests } from '../../services/askDmService.js';
import { ensureActiveRiddle } from '../../services/riddleService.js';
import { acceptSessionOperation } from '../../services/sessionOperationService.js';
import { StateService } from '../../services/stateService.js';
import type { AskDmPayload } from '../../types.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('../../providers/ai/AiProviderFactory.js', () => ({
  createNarrationProvider: vi.fn(),
  createChatClientForTier: vi.fn(() => ({ client: { chat: { completions: { create: mocks.create } } }, model: 'mock' })),
}));

let paths: IntegrationTestPaths;
let server: Server;
let baseUrl: string;

const answerWith = (answer: string) => mocks.create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ answer }) } }] });

const ask = (sessionId: string, body: Record<string, unknown>) => fetch(`${baseUrl}/session/${sessionId}/ask`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const seed = async (id: string, overrides: Parameters<typeof makeTestSession>[0] = {}): Promise<{ turnId: number; revision: number }> => {
  await insertSessionState(makeTestSession({ id, ...overrides }));
  await StateService.addTurnResult(id, { narration: 'A rope bridge sways over the gorge.', choices: [], imagePrompt: null, imageSuggested: false }, null);
  const history = await StateService.getTurnHistory(id);
  return { turnId: history[history.length - 1].id as number, revision: StateService.getRevision(id) ?? 0 };
};

beforeAll(async () => {
  paths = setupIntegrationEnvironment('ask-dm');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.namespaceId = 'local';
    req.userEmail = null;
    next();
  });
  app.use(createAskRouter());
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  resetAskDmStateForTests();
  mocks.create.mockReset();
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  cleanupIntegrationEnvironment(paths);
});

describe('POST /session/:id/ask', () => {
  it('answers from public facts only and changes nothing', async () => {
    const key = await seed('ask-basic', { adventurePlan: 'SECRET: the bridge is a mimic', dmPrep: 'SECRET prep' });
    answerWith('You could test the planks first—or ask Zara to float across!');

    const res = await ask('ask-basic', { question: 'Can I cross the bridge?', ...key });

    expect(res.status).toBe(200);
    const payload = await res.json() as AskDmPayload;
    expect(payload).toMatchObject({ ...key, question: 'Can I cross the bridge?' });
    // Em dashes never reach players.
    expect(payload.answer).toBe('You could test the planks first - or ask Zara to float across!');
    const prompt = JSON.stringify(mocks.create.mock.calls[0][0].messages);
    expect(prompt).toContain('A rope bridge sways over the gorge.');
    expect(prompt).toContain('Can I cross the bridge?');
    expect(prompt).not.toContain('SECRET');
    // Transient: no turn, no revision bump.
    expect(await StateService.getTurnHistory('ask-basic')).toHaveLength(1);
    expect(StateService.getRevision('ask-basic')).toBe(key.revision);
  });

  it('never gives away the answer to an open riddle, even when the model does', async () => {
    const key = await seed('ask-riddle');
    const session = await StateService.getSession('ask-riddle');
    ensureActiveRiddle({
      id: 'ask-riddle',
      turn: session?.turn ?? 1,
      lastChoices: [{ label: 'Answer: a river', difficulty: 'normal', stat: 'mischief', riddleAnswer: 'a river', riddleCorrect: true }],
    });
    answerWith('Think about water... it is a river!');

    const res = await ask('ask-riddle', { question: 'What is the answer to the riddle?', ...key });

    expect((await res.json() as AskDmPayload).answer).toBe(RIDDLE_SAFE_ANSWER);
    expect(JSON.stringify(mocks.create.mock.calls[0][0].messages)).not.toContain('river');
  });

  it('rejects a question about an earlier moment in the story', async () => {
    const key = await seed('ask-stale');

    const res = await ask('ask-stale', { question: 'What now?', turnId: key.turnId, revision: key.revision + 1 });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'stale_question' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('waits while an action is being resolved', async () => {
    const key = await seed('ask-busy');
    acceptSessionOperation({ sessionId: 'ask-busy', namespaceId: 'local', kind: 'action', requestId: 'busy', payload: {} });

    const res = await ask('ask-busy', { question: 'What now?', ...key });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'operation_in_progress' });
  });

  it('limits questions per session', async () => {
    const key = await seed('ask-limit');
    for (let i = 0; i < 6; i++) {
      answerWith('Try it and see!');
      expect((await ask('ask-limit', { question: `Question ${i}?`, ...key })).status).toBe(200);
    }

    const limited = await ask('ask-limit', { question: 'One more?', ...key });

    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: 'ask_rate_limited' });
  });

  it('reports a failed answer as retryable', async () => {
    const key = await seed('ask-failed');
    mocks.create.mockRejectedValueOnce(new Error('provider down'));

    const res = await ask('ask-failed', { question: 'Is the bridge safe?', ...key });

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'ask_failed' });
  });
});
