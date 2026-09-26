import os from 'os';
import path from 'path';
import fs from 'fs';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../persistence/database.js';
import { operationRepository } from '../repositories/operationRepository.js';
import { turnHistoryRepository } from '../repositories/turnHistoryRepository.js';
import { autoConfirmRepository } from '../repositories/autoConfirmRepository.js';
import { StateService } from '../services/stateService.js';
import { accessTokenService } from '../services/accessTokenService.js';
import { runAcceptedTurnAction } from '../services/turnSubmissionService.js';
import { previewFreeAction } from '../services/statSuggestionService.js';
import { resetMcpRateLimits } from './auth.js';
import { clearPreviewDedupForTests } from './previewDedup.js';
import { setUndoWindowMsForTests } from './playTools.js';
import { createPilot, insertSession, makeCallTool, setMcpTestEnv, startMcpServer } from './testHarness.js';

vi.mock('../services/statSuggestionService.js', async importOriginal => ({
  ...await importOriginal<typeof import('../services/statSuggestionService.js')>(),
  previewFreeAction: vi.fn(async () => ({ stat: 'mischief', interpretedAction: 'Pip throws a knife at the hidden lever' })),
}));

vi.mock('../services/turnSubmissionService.js', () => ({ runAcceptedTurnAction: vi.fn() }));

const DB_PATH = path.join(os.tmpdir(), `dnd-mcp-play-test-${Date.now()}.sqlite`);

let server: Server;
let callTool: ReturnType<typeof makeCallTool>;
let baseUrl: string;
let pilotA: ReturnType<typeof createPilot>;
let pilotB: ReturnType<typeof createPilot>;
let sharedRealmSecretB: string;
let readOnly: ReturnType<typeof createPilot>;
let seq = 0;

const newSession = () => {
  const id = `play-${++seq}`;
  insertSession(id, pilotA.namespaceId, `Goblin Throne ${seq}`);
  return id;
};

const structured = <T>(response: Awaited<ReturnType<typeof callTool>>): T => response.body?.result?.structuredContent as T;
const isError = (response: Awaited<ReturnType<typeof callTool>>) => response.body?.result?.isError === true;
const errorText = (response: Awaited<ReturnType<typeof callTool>>) => response.body?.result?.content?.[0]?.text ?? '';

const preview = async (sessionId: string, extra: Record<string, unknown> = {}) =>
  callTool(pilotA.secret, 'preview_action', { adventureId: sessionId, expectedRevision: 0, action: 'I throw a knife at the lever', ...extra });

beforeAll(() => {
  setMcpTestEnv(DB_PATH);
  StateService.initialize();
  pilotA = createPilot('play-a@example.com');
  pilotB = createPilot('play-b@example.com');
  readOnly = createPilot('play-read@example.com', []);
  // pilotB also plays in pilotA's realm, with a token for that realm.
  getDb().prepare('INSERT INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(pilotB.userId, pilotA.namespaceId);
  const shared = accessTokenService.create({ userId: pilotB.userId, namespaceId: pilotA.namespaceId, label: 'shared realm', scopes: ['adventures:play'] });
  if (!shared.ok) {
    throw new Error(`could not mint shared-realm token: ${shared.error}`);
  }
  sharedRealmSecretB = shared.secret;
  const started = startMcpServer();
  server = started.server;
  baseUrl = started.baseUrl;
  callTool = makeCallTool(started.baseUrl);
});

beforeEach(() => {
  resetMcpRateLimits();
  clearPreviewDedupForTests();
  vi.mocked(runAcceptedTurnAction).mockClear();
  vi.mocked(previewFreeAction).mockClear();
  setUndoWindowMsForTests(null);
});

afterAll(() => {
  server?.close();
  fs.rmSync(DB_PATH, { force: true });
});

describe('preview_action', () => {
  it('returns the server interpretation and a preview id', async () => {
    const sessionId = newSession();
    const res = await preview(sessionId);
    const view = structured<{ outcome: string; previewId: string; interpretedAction: string; stat: string; heroName: string; autoConfirmEligible: boolean }>(res);
    expect(view).toMatchObject({ outcome: 'preview', interpretedAction: 'Pip throws a knife at the hidden lever', stat: 'mischief', heroName: 'Pip', autoConfirmEligible: true });
    expect(view.previewId).toBeTruthy();
  });

  it('needs the play scope', async () => {
    const res = await callTool(readOnly.secret, 'preview_action', { adventureId: newSession(), expectedRevision: 0, action: 'x' });
    expect(isError(res)).toBe(true);
    expect(previewFreeAction).not.toHaveBeenCalled();
  });

  it('refuses a stale revision without calling the model', async () => {
    const res = await preview(newSession(), { expectedRevision: 5 });
    expect(isError(res)).toBe(true);
    expect(errorText(res)).toContain('stale_revision');
    expect(previewFreeAction).not.toHaveBeenCalled();
  });

  it('pays once for a retried preview with the same request id', async () => {
    const sessionId = newSession();
    const first = structured<{ previewId: string }>(await preview(sessionId, { requestId: 'preview-req-1' }));
    const second = structured<{ previewId: string }>(await preview(sessionId, { requestId: 'preview-req-1' }));
    expect(second.previewId).toBe(first.previewId);
    expect(previewFreeAction).toHaveBeenCalledTimes(1);
    const conflict = await preview(sessionId, { requestId: 'preview-req-1', action: 'Something else' });
    expect(errorText(conflict)).toContain('request_id_conflict');
  });
});

describe('undo window', () => {
  it('marks clean previews eligible by default, unless the player chose to be asked', async () => {
    const sessionId = newSession();
    expect(structured<{ autoConfirmEligible: boolean }>(await preview(sessionId)).autoConfirmEligible).toBe(true);
    expect(structured<{ autoConfirmSafe: boolean }>(await callTool(pilotA.secret, 'get_adventure', { adventureId: sessionId })).autoConfirmSafe).toBe(true);

    const clarified = await preview(sessionId, { clarifications: [{ question: 'Which lever?', answer: 'The rusty one' }] });
    expect(structured<{ autoConfirmEligible: boolean }>(clarified).autoConfirmEligible).toBe(false);

    autoConfirmRepository.set(pilotA.userId, sessionId, false, Date.now());
    expect(structured<{ autoConfirmEligible: boolean }>(await preview(sessionId)).autoConfirmEligible).toBe(false);
    expect(structured<{ autoConfirmSafe: boolean }>(await callTool(pilotA.secret, 'get_adventure', { adventureId: sessionId })).autoConfirmSafe).toBe(false);
  });

  it('is per player: one player asking first does not change another', async () => {
    const sessionId = newSession();
    autoConfirmRepository.set(pilotA.userId, sessionId, false, Date.now());
    const other = await callTool(sharedRealmSecretB, 'preview_action', { adventureId: sessionId, expectedRevision: 0, action: 'I throw a knife at the lever' });
    expect(structured<{ autoConfirmEligible: boolean }>(other).autoConfirmEligible).toBe(true);
  });

  it('sends an eligible preview after the window', async () => {
    setUndoWindowMsForTests(50);
    const sessionId = newSession();
    const { previewId } = structured<{ previewId: string }>(await preview(sessionId));
    const res = await callTool(pilotA.secret, 'confirm_action', { adventureId: sessionId, previewId, expectedRevision: 0, requestId: 'undo-send-0001', undoWindow: true });
    expect(structured<{ operation: { status: string } }>(res).operation.status).toBe('accepted');
    expect(runAcceptedTurnAction).toHaveBeenCalledTimes(1);
  });

  it('refuses the window for a preview that needs the player', async () => {
    const sessionId = newSession();
    autoConfirmRepository.set(pilotA.userId, sessionId, false, Date.now());
    const { previewId } = structured<{ previewId: string }>(await preview(sessionId));
    const res = await callTool(pilotA.secret, 'confirm_action', { adventureId: sessionId, previewId, expectedRevision: 0, requestId: 'undo-refuse-0001', undoWindow: true });
    expect(errorText(res)).toContain('needs_player_ok');
    expect(runAcceptedTurnAction).not.toHaveBeenCalled();
  });

  it('sends nothing when the player interrupts during the window', async () => {
    setUndoWindowMsForTests(400);
    const sessionId = newSession();
    const { previewId } = structured<{ previewId: string }>(await preview(sessionId));
    const controller = new AbortController();
    const call = fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${pilotA.secret}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'confirm_action', arguments: { adventureId: sessionId, previewId, expectedRevision: 0, requestId: 'undo-stop-0001', undoWindow: true } } }),
    }).catch(() => null);
    await new Promise(resolve => setTimeout(resolve, 100));
    controller.abort();
    await call;
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(operationRepository.getByRequestId(sessionId, 'undo-stop-0001')).toBeNull();
    expect(runAcceptedTurnAction).not.toHaveBeenCalled();
  });
});

describe('confirm_action', () => {
  it('accepts a preview once and replays the same request id', async () => {
    const sessionId = newSession();
    const { previewId } = structured<{ previewId: string }>(await preview(sessionId));
    const args = { adventureId: sessionId, previewId, expectedRevision: 0, requestId: 'confirm-req-1' };
    const first = structured<{ operation: { id: string; status: string }; replayed: boolean }>(await callTool(pilotA.secret, 'confirm_action', args));
    expect(first.operation.status).toBe('accepted');
    expect(first.replayed).toBe(false);
    expect(runAcceptedTurnAction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runAcceptedTurnAction).mock.calls[0][3]).toMatchObject({ previewId, statUsed: 'mischief' });

    const replay = structured<{ operation: { id: string }; replayed: boolean }>(await callTool(pilotA.secret, 'confirm_action', args));
    expect(replay).toMatchObject({ operation: { id: first.operation.id }, replayed: true });
    expect(runAcceptedTurnAction).toHaveBeenCalledTimes(1);
  });

  it('accepts only one of many concurrent confirmations', async () => {
    const sessionId = newSession();
    const { previewId } = structured<{ previewId: string }>(await preview(sessionId));
    const responses = await Promise.all(Array.from({ length: 20 }, () =>
      callTool(pilotA.secret, 'confirm_action', { adventureId: sessionId, previewId, expectedRevision: 0, requestId: 'confirm-race-1' })));
    const ids = new Set(responses.filter(r => !isError(r)).map(r => structured<{ operation: { id: string } }>(r).operation.id));
    expect(ids.size).toBe(1);
    expect(runAcceptedTurnAction).toHaveBeenCalledTimes(1);
  });

  it('refuses a preview made by another token, even in a shared realm', async () => {
    const sessionId = newSession();
    const { previewId } = structured<{ previewId: string }>(await preview(sessionId));
    const res = await callTool(sharedRealmSecretB, 'confirm_action', { adventureId: sessionId, previewId, expectedRevision: 0, requestId: 'confirm-other-1' });
    expect(errorText(res)).toContain('stale_preview');
    expect(runAcceptedTurnAction).not.toHaveBeenCalled();
  });

  it('refuses an unknown preview', async () => {
    const res = await callTool(pilotA.secret, 'confirm_action', { adventureId: newSession(), previewId: 'nope', expectedRevision: 0, requestId: 'confirm-unknown-1' });
    expect(errorText(res)).toContain('stale_preview');
  });
});

describe('get_operation', () => {
  it('reports a pending operation, then the committed turns', async () => {
    const sessionId = newSession();
    const { previewId } = structured<{ previewId: string }>(await preview(sessionId));
    const { operation } = structured<{ operation: { id: string } }>(await callTool(pilotA.secret, 'confirm_action', { adventureId: sessionId, previewId, expectedRevision: 0, requestId: 'confirm-op-1' }));

    const pending = structured<{ done: boolean; retryAfterSeconds: number | null }>(await callTool(pilotA.secret, 'get_operation', { adventureId: sessionId, operationId: operation.id, waitSeconds: 0 }));
    expect(pending).toMatchObject({ done: false, retryAfterSeconds: 3 });

    const turnId = turnHistoryRepository.insertTurnResultSync(sessionId, {
      narration: 'The cage slams down on the Goblin King!',
      choices: [],
      imagePrompt: null,
      imageSuggested: false,
      lastAction: { actionAttempt: 'Pip throws a knife at the lever', actionResult: { success: true, roll: 17, statUsed: 'mischief', difficultyTarget: 12 } },
    }, `${sessionId}-hero`, operation.id);
    operationRepository.completeSync(operation.id, turnId, 1);

    const byRequest = structured<{ done: boolean; turns: { narration: string; action: { success: boolean } }[] }>(
      await callTool(pilotA.secret, 'get_operation', { adventureId: sessionId, requestId: 'confirm-op-1', waitSeconds: 0 }));
    expect(byRequest.done).toBe(true);
    expect(byRequest.turns).toEqual([expect.objectContaining({ narration: 'The cage slams down on the Goblin King!', action: expect.objectContaining({ success: true }) })]);
  });

  it('tells the host a lost write never arrived', async () => {
    const res = await callTool(pilotA.secret, 'get_operation', { adventureId: newSession(), requestId: 'never-sent-1', waitSeconds: 0 });
    expect(errorText(res)).toContain('safe to send it again');
  });
});
