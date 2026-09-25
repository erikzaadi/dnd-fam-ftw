import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../persistence/database.js';
import { createStatSuggestionRouter } from '../../routes/statSuggestionRoutes.js';
import { createTurnRouter } from '../../routes/turnRoutes.js';
import { StateService } from '../../services/stateService.js';
import type { Choice, FreeActionPreview, PreviewClarification, SessionSnapshot } from '../../types.js';
import { resetMockNarrationProvider } from './mockNarrationProvider.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

const { mockCreateCompletion } = vi.hoisted(() => ({ mockCreateCompletion: vi.fn() }));

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createMockNarrationProvider } = await import('./mockNarrationProvider.js');
  return {
    createNarrationProvider: vi.fn(() => createMockNarrationProvider()),
    createChatClientForTier: vi.fn(() => ({
      client: { chat: { completions: { create: mockCreateCompletion } } },
      model: 'mock-chat',
    })),
  };
});

let paths: IntegrationTestPaths;
let server: Server;
let baseUrl: string;

const RIDDLE_CHOICES: Choice[] = [
  { label: 'Answer: a piano', difficulty: 'normal', stat: 'magic', difficultyValue: 12, riddleAnswer: 'a piano', riddleCorrect: true },
  { label: 'Answer: a jailer', difficulty: 'normal', stat: 'magic', difficultyValue: 12, riddleAnswer: 'a jailer', riddleCorrect: false },
  { label: 'Search the door frame', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
];

const DRAFT = 'I play the piano with a flourish';

const seedRiddle = async (id: string): Promise<void> => {
  await insertSessionState(makeTestSession({ id, party: [makeTestSession().party[0]], activeCharacterId: 'char-pip' }));
  await StateService.addTurnResult(id, { narration: 'The door sings: "I have keys but open no locks."', choices: RIDDLE_CHOICES, imagePrompt: null, imageSuggested: false }, null);
};

const preview = (sessionId: string, body: Record<string, unknown>) => fetch(`${baseUrl}/session/${sessionId}/preview-action`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const confirm = (sessionId: string, body: Record<string, unknown>) => fetch(`${baseUrl}/session/${sessionId}/action`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const waitForIdle = async (sessionId: string): Promise<void> => {
  await vi.waitFor(async () => {
    const snapshot = await (await fetch(`${baseUrl}/session/${sessionId}/snapshot`)).json() as SessionSnapshot;
    expect(snapshot.activeOperation).toBeNull();
  });
};

const riddleStatus = (sessionId: string): string | undefined =>
  (getDb().prepare('SELECT status FROM session_riddles WHERE session_id = ?').get(sessionId) as { status: string } | undefined)?.status;

beforeAll(async () => {
  paths = setupIntegrationEnvironment('preview-clarification');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.namespaceId = 'local';
    req.userEmail = null;
    next();
  });
  app.use(createStatSuggestionRouter());
  app.use(createTurnRouter());
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  resetMockNarrationProvider();
  mockCreateCompletion.mockReset();
  mockCreateCompletion.mockResolvedValue({ choices: [{ message: { content: '{"stat":"magic","interpretedAction":"Pip answers the door: a piano"}' } }] });
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  cleanupIntegrationEnvironment(paths);
});

describe('preview clarification contract', () => {
  it('asks instead of previewing, without a model call or any stored state', async () => {
    await seedRiddle('clarify-ask');
    const res = await preview('clarify-ask', { action: DRAFT, supports: ['clarification'] });

    expect(res.status).toBe(200);
    const body = await res.json() as PreviewClarification;
    expect(body).toEqual({ kind: 'clarification', question: 'Is "piano" your answer to the riddle?', previewRevision: StateService.getRevision('clarify-ask') });
    expect(mockCreateCompletion).not.toHaveBeenCalled();
    expect(riddleStatus('clarify-ask')).toBe('active');
  });

  it('gives clients without clarification support the question as a retryable error', async () => {
    await seedRiddle('clarify-legacy');
    const res = await preview('clarify-legacy', { action: DRAFT });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'riddle_unclear', message: 'Is "piano" your answer to the riddle?' });
  });

  it('reads "yes" together with the draft: the previewed answer resolves the riddle without a roll', async () => {
    await seedRiddle('clarify-yes');
    const question = 'Is "piano" your answer to the riddle?';
    const res = await preview('clarify-yes', { action: DRAFT, supports: ['clarification'], clarifications: [{ question, answer: 'Yes!' }] });

    expect(res.status).toBe(200);
    const body = await res.json() as FreeActionPreview;
    expect(body.previewId).toBeTruthy();
    expect(body.originalAction).toBe(DRAFT);
    expect(body.warnings[0]).toMatch(/Riddle answer/);
    expect(mockCreateCompletion.mock.calls[0][0].messages[0].content).toContain('the player answered "Yes!"');

    const accepted = await confirm('clarify-yes', { action: body.originalAction, statUsed: body.stat, previewId: body.previewId, requestId: 'clarify-yes-1' });
    expect(accepted.status).toBe(202);
    await waitForIdle('clarify-yes');
    const history = await StateService.getTurnHistory('clarify-yes');
    expect(history[1].lastAction?.actionResult).toMatchObject({ success: true, roll: 0, statUsed: 'none' });
    expect(riddleStatus('clarify-yes')).toBe('solved');
  });

  it('reads "no" as an ordinary action: it rolls and the riddle stays open', async () => {
    await seedRiddle('clarify-no');
    const res = await preview('clarify-no', { action: DRAFT, supports: ['clarification'], clarifications: [{ question: 'Is "piano" your answer to the riddle?', answer: 'No' }] });
    const body = await res.json() as FreeActionPreview;
    expect(body.warnings.join(' ')).not.toMatch(/Riddle answer/);

    await confirm('clarify-no', { action: body.originalAction, statUsed: body.stat, previewId: body.previewId, requestId: 'clarify-no-1' });
    await waitForIdle('clarify-no');
    const history = await StateService.getTurnHistory('clarify-no');
    expect(history[1].lastAction?.actionResult.roll).toBeGreaterThan(0);
    expect(riddleStatus('clarify-no')).toBe('active');
  });

  it('stops asking after two rounds and asks the player to rephrase', async () => {
    await seedRiddle('clarify-limit');
    const clarifications = [
      { question: 'Which one is your answer to the riddle?', answer: 'yes' },
      { question: 'Which one is your answer to the riddle?', answer: 'yes' },
    ];
    const res = await preview('clarify-limit', { action: 'a piano or a jailer', supports: ['clarification'], clarifications });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'clarification_limit' });
  });

  it('never puts the hidden answer in a question', async () => {
    await seedRiddle('clarify-private');
    for (const action of ['not a jailer', 'a lighthouse', 'a piano or a jailer']) {
      const text = await (await preview('clarify-private', { action, supports: ['clarification'] })).text();
      expect(text).not.toContain('piano');
    }
  });
});
