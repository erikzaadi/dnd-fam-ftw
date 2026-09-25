import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../persistence/database.js';
import { operationRepository } from '../../repositories/operationRepository.js';
import { commitTurn, StaleRevisionError } from '../../repositories/turnCommitRepository.js';
import { turnHistoryRepository } from '../../repositories/turnHistoryRepository.js';
import { createEventsRouter } from '../../routes/eventsRoutes.js';
import { createTurnRouter } from '../../routes/turnRoutes.js';
import { createSessionRouter } from '../../routes/sessionRoutes.js';
import { resolvePartyRecovery } from '../../services/partyRecoveryService.js';
import { acceptSessionOperation, reconcileInterruptedOperations } from '../../services/sessionOperationService.js';
import { StateService } from '../../services/stateService.js';
import type { NarrationOutput } from '../../providers/ai/narration/NarrationProvider.js';
import type { SessionOperation, SessionSnapshot, SessionState, TurnResult } from '../../types.js';
import { FIXED_NARRATION_OUTPUT, mockGenerateTurn, pinTurnStrategy, resetMockNarrationProvider } from './mockNarrationProvider.js';
import { cleanupIntegrationEnvironment, insertSessionState, makeTestSession, setupIntegrationEnvironment, type IntegrationTestPaths } from './testSessionFixtures.js';

vi.mock('../../providers/ai/AiProviderFactory.js', async () => {
  const { createMockNarrationProvider } = await import('./mockNarrationProvider.js');
  return {
    createNarrationProvider: vi.fn(() => createMockNarrationProvider()),
    createChatClientForTier: vi.fn(),
  };
});

// Operation ledger, idempotency, concurrency and retry behavior does not depend on the
// turn strategy. These tests script the parallel monolith (delays, 429s), so they pin it
// explicitly instead of silently falling back from the resolved_first default.
pinTurnStrategy('parallel');

let paths: IntegrationTestPaths;
let server: Server;
let baseUrl: string;

const makeTurn = (narration: string): TurnResult => ({
  narration,
  choices: [],
  imagePrompt: null,
  imageSuggested: false,
  lastAction: null,
  turnType: 'normal',
});

const stateRow = (sessionId: string) => getDb().prepare('SELECT turn, revision FROM sessions WHERE id = ?').get(sessionId) as { turn: number; revision: number };

type SseEvent = Record<string, unknown> & { type: string };

// Minimal SSE reader over fetch: collects parsed events until the predicate matches.
const collectEvents = async (sessionId: string, until: (event: SseEvent) => boolean, timeoutMs = 5000): Promise<SseEvent[]> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`${baseUrl}/session/${sessionId}/events`, { signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame.replace(/^data: /, '');
        if (!data) {
          continue;
        }
        const event = JSON.parse(data) as SseEvent;
        events.push(event);
        if (until(event)) {
          return events;
        }
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return events;
};

const waitForConnected = async (sessionId: string, run: () => Promise<void>, until: (event: SseEvent) => boolean): Promise<SseEvent[]> => {
  const collecting = collectEvents(sessionId, until);
  // Give the stream a moment to register before triggering work.
  await new Promise(resolve => setTimeout(resolve, 50));
  await run();
  return collecting;
};

const postAction = (sessionId: string, body: Record<string, unknown>) => fetch(`${baseUrl}/session/${sessionId}/action`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  paths = setupIntegrationEnvironment('operations');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.namespaceId = 'local';
    req.userEmail = null;
    next();
  });
  app.use(createEventsRouter());
  app.use(createSessionRouter());
  app.use(createTurnRouter());
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  resetMockNarrationProvider();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  cleanupIntegrationEnvironment(paths);
});

describe('operation ledger (R1)', () => {
  it('replays an accepted request ID and rejects reuse with a different payload', async () => {
    await insertSessionState(makeTestSession({ id: 'ops-replay' }));
    const first = acceptSessionOperation({ sessionId: 'ops-replay', namespaceId: 'local', kind: 'action', requestId: 'req-1', payload: { action: 'Sneak' } });
    expect(first.type).toBe('accepted');

    const replay = acceptSessionOperation({ sessionId: 'ops-replay', namespaceId: 'local', kind: 'action', requestId: 'req-1', payload: { action: 'Sneak' } });
    expect(replay.type).toBe('replay');
    if (first.type === 'accepted' && replay.type === 'replay') {
      expect(replay.operation.id).toBe(first.operation.id);
    }

    const conflicting = acceptSessionOperation({ sessionId: 'ops-replay', namespaceId: 'local', kind: 'action', requestId: 'req-1', payload: { action: 'Charge' } });
    expect(conflicting).toMatchObject({ type: 'conflict', code: 'request_id_conflict' });
  });

  it('allows only one active operation per session', async () => {
    await insertSessionState(makeTestSession({ id: 'ops-guard' }));
    expect(acceptSessionOperation({ sessionId: 'ops-guard', namespaceId: 'local', kind: 'action', requestId: 'a', payload: { n: 1 } }).type).toBe('accepted');
    expect(acceptSessionOperation({ sessionId: 'ops-guard', namespaceId: 'local', kind: 'action', requestId: 'b', payload: { n: 2 } }))
      .toMatchObject({ type: 'conflict', code: 'operation_in_progress' });
  });

  it('rejects a stale expected revision', async () => {
    await insertSessionState(makeTestSession({ id: 'ops-stale' }));
    StateService.bumpRevision('ops-stale');
    expect(acceptSessionOperation({ sessionId: 'ops-stale', namespaceId: 'local', kind: 'action', requestId: 'r', expectedRevision: 0, payload: {} }))
      .toMatchObject({ type: 'conflict', code: 'stale_revision', currentRevision: 1 });
  });

  it('fails interrupted operations on startup instead of re-running them', async () => {
    await insertSessionState(makeTestSession({ id: 'ops-restart' }));
    const accepted = acceptSessionOperation({ sessionId: 'ops-restart', namespaceId: 'local', kind: 'action', requestId: 'r', payload: {} });
    reconcileInterruptedOperations();
    if (accepted.type !== 'accepted') {
      throw new Error('expected accepted');
    }
    const stored = operationRepository.get('ops-restart', accepted.operation.id);
    expect(stored).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
    // The guard is free again, so the player can retry as a new operation.
    expect(acceptSessionOperation({ sessionId: 'ops-restart', namespaceId: 'local', kind: 'action', requestId: 'r2', payload: {} }).type).toBe('accepted');
  });
});

describe('commitTurn (R1/R2)', () => {
  it('rejects a second commit computed from the same base revision', async () => {
    const session = makeTestSession({ id: 'commit-cas' });
    await insertSessionState(session);
    commitTurn({ sessionId: 'commit-cas', expectedRevision: 0, state: { ...session, turn: 2 }, turn: makeTurn('first'), characterId: null });
    expect(() => commitTurn({ sessionId: 'commit-cas', expectedRevision: 0, state: { ...session, turn: 2 }, turn: makeTurn('second'), characterId: null }))
      .toThrow(StaleRevisionError);
    const history = await StateService.getTurnHistory('commit-cas');
    expect(history.map(h => h.narration)).toEqual(['first']);
    expect(stateRow('commit-cas')).toMatchObject({ turn: 2, revision: 1 });
  });

  it('rolls back state, inventory, history and operation when the history write fails', async () => {
    const pip = { ...makeTestSession().party[0], inventory: [{ id: 'potion', name: 'Potion', description: 'Heals', healValue: 3 }] };
    const session = makeTestSession({ id: 'commit-fault', party: [pip] });
    await insertSessionState(session);
    const accepted = acceptSessionOperation({ sessionId: 'commit-fault', namespaceId: 'local', kind: 'action', requestId: 'fault', payload: {} });
    if (accepted.type !== 'accepted') {
      throw new Error('expected accepted');
    }

    vi.spyOn(turnHistoryRepository, 'insertTurnResultSync').mockImplementation(() => {
      throw new Error('disk full');
    });
    const changed: SessionState = { ...session, turn: 2, party: [{ ...pip, hp: 1, inventory: [] }] };
    expect(() => commitTurn({ sessionId: 'commit-fault', expectedRevision: 0, state: changed, turn: makeTurn('never'), characterId: null, operationId: accepted.operation.id }))
      .toThrow('disk full');

    const stored = await StateService.getSession('commit-fault');
    expect(stored?.turn).toBe(1);
    expect(stored?.party[0].hp).toBe(pip.hp);
    expect(stored?.party[0].inventory.map(i => i.name)).toEqual(['Potion']);
    expect(await StateService.getTurnHistory('commit-fault')).toHaveLength(0);
    expect(stateRow('commit-fault').revision).toBe(0);
    expect(operationRepository.get('commit-fault', accepted.operation.id)?.status).toBe('accepted');
  });

  it('keeps media stored by background jobs while the turn was generating', async () => {
    const encounter = {
      id: 'enc-media',
      name: 'Pan Ambush',
      status: 'active' as const,
      round: 1,
      enemies: [{ id: 'pan', name: 'Pan', role: 'minion' as const, hp: 3, maxHp: 3, status: 'active' as const }],
      areas: [{ id: 'stove', label: 'Stove', description: 'Hot', tags: [] }],
    };
    const session = makeTestSession({ id: 'commit-media', encounterState: encounter });
    await insertSessionState(session);
    // Background jobs finish after the gameplay snapshot was read.
    StateService.updateCharacterAvatar('char-pip', '/avatars/pip.png', 'prompt', 'pip-key', 'local');
    await StateService.patchEncounterEnemyAvatar('commit-media', 'enc-media', 'pan', '/enemies/pan.png');
    await StateService.patchEncounterAreaImage('commit-media', 'enc-media', 'stove', '/areas/stove.png');

    const staleSnapshot: SessionState = {
      ...session,
      turn: 2,
      party: session.party.map(c => ({ ...c, avatarUrl: undefined })),
      encounterState: { ...encounter, enemies: [{ ...encounter.enemies[0], hp: 1 }] },
    };
    commitTurn({ sessionId: 'commit-media', expectedRevision: 0, state: staleSnapshot, turn: makeTurn('hit'), characterId: 'char-pip' });

    const stored = await StateService.getSession('commit-media');
    expect(stored?.party.find(c => c.id === 'char-pip')?.avatarUrl).toBe('/avatars/pip.png');
    expect(stored?.encounterState?.enemies[0]).toMatchObject({ hp: 1, avatarUrl: '/enemies/pan.png' });
    expect(stored?.encounterState?.areas[0].imageUrl).toBe('/areas/stove.png');
  });
});

describe('party wipe recovery stays inside the operation', () => {
  it('keeps the operation running after the wiping turn and completes it with the rescue turn', async () => {
    const session = makeTestSession({ id: 'wipe-rescue' });
    await insertSessionState(session);
    const accepted = acceptSessionOperation({ sessionId: 'wipe-rescue', namespaceId: 'local', kind: 'action', requestId: 'wipe', payload: {} });
    if (accepted.type !== 'accepted') {
      throw new Error('expected accepted');
    }
    const wiped: SessionState = { ...session, turn: 2, party: session.party.map(c => ({ ...c, hp: 0, status: 'downed' as const })) };
    const wipeCommit = commitTurn({
      sessionId: 'wipe-rescue',
      expectedRevision: 0,
      state: wiped,
      turn: makeTurn('The party falls.'),
      characterId: 'char-pip',
      operationId: accepted.operation.id,
      completeOperation: false,
      continuingPhase: 'recovering',
    });
    expect(operationRepository.get('wipe-rescue', accepted.operation.id)).toMatchObject({ status: 'running', phase: 'recovering' });

    await resolvePartyRecovery({
      sessionId: 'wipe-rescue',
      namespaceId: 'local',
      operationId: accepted.operation.id,
      outcome: 'intervention',
      wipedState: { ...wiped, revision: wipeCommit.revision },
      revision: wipeCommit.revision,
    });

    const stored = await StateService.getSession('wipe-rescue');
    expect(stored?.party.every(c => c.status === 'active' && c.hp === 1)).toBe(true);
    expect(stored?.interventionState.rescuesUsed).toBe(1);
    const history = await StateService.getTurnHistory('wipe-rescue');
    expect(history.map(h => h.turnType)).toEqual(['normal', 'intervention']);
    expect(operationRepository.get('wipe-rescue', accepted.operation.id)).toMatchObject({ status: 'completed', resultRevision: 2 });
  });
});

describe('action route lifecycle (R1/R3)', () => {
  it('accepts with 202, completes over SSE with the operation ID, and replays without re-rolling', async () => {
    await insertSessionState(makeTestSession({ id: 'route-lifecycle' }));

    let response: Response | undefined;
    const events = await waitForConnected('route-lifecycle', async () => {
      response = await postAction('route-lifecycle', { action: 'Sneak past the cook', statUsed: 'mischief', difficulty: 'normal', requestId: 'lifecycle-1', expectedRevision: 0 });
    }, event => event.type === 'turn_complete');

    expect(response?.status).toBe(202);
    const accepted = await response!.json() as { queued: boolean; operation: SessionOperation };
    expect(accepted.queued).toBe(true);
    const complete = events.find(e => e.type === 'turn_complete')!;
    expect(complete.operationId).toBe(accepted.operation.id);
    expect(complete.revision).toBe(1);
    expect((complete.session as Record<string, unknown>).dmPrep).toBeUndefined();

    const status = await fetch(`${baseUrl}/session/route-lifecycle/operations/${accepted.operation.id}`);
    expect(await status.json()).toMatchObject({ status: 'completed', resultRevision: 1 });

    // A lost response retried with the same request ID returns the stored outcome.
    const replay = await postAction('route-lifecycle', { action: 'Sneak past the cook', statUsed: 'mischief', difficulty: 'normal', requestId: 'lifecycle-1', expectedRevision: 0 });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, queued: false, operation: { id: accepted.operation.id, status: 'completed' } });
    expect(mockGenerateTurn).toHaveBeenCalledTimes(1);
    expect(await StateService.getTurnHistory('route-lifecycle')).toHaveLength(1);

    const snapshot = await (await fetch(`${baseUrl}/session/route-lifecycle/snapshot`)).json() as SessionSnapshot;
    expect(snapshot.revision).toBe(1);
    expect(snapshot.history).toHaveLength(1);
    expect(snapshot.activeOperation).toBeNull();
    expect(snapshot.latestOperation?.id).toBe(accepted.operation.id);
  });

  it('rejects a concurrent action from another tablet while one is resolving', async () => {
    await insertSessionState(makeTestSession({ id: 'route-concurrent' }));
    let release!: (output: NarrationOutput) => void;
    mockGenerateTurn.mockImplementationOnce(() => new Promise(resolve => {
      release = resolve;
    }));

    const first = await postAction('route-concurrent', { action: 'Charge', statUsed: 'might', requestId: 'tablet-a', expectedRevision: 0 });
    expect(first.status).toBe(202);
    const second = await postAction('route-concurrent', { action: 'Hide', statUsed: 'mischief', requestId: 'tablet-b', expectedRevision: 0 });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: 'operation_in_progress' });

    const snapshotWhilePending = await (await fetch(`${baseUrl}/session/route-concurrent/snapshot`)).json() as SessionSnapshot;
    expect(snapshotWhilePending.activeOperation?.requestId).toBe('tablet-a');

    await vi.waitFor(() => expect(release).toBeDefined());
    release(FIXED_NARRATION_OUTPUT);
    await vi.waitFor(async () => {
      const snapshot = await (await fetch(`${baseUrl}/session/route-concurrent/snapshot`)).json() as SessionSnapshot;
      expect(snapshot.activeOperation).toBeNull();
      expect(snapshot.revision).toBe(1);
    });
    expect(await StateService.getTurnHistory('route-concurrent')).toHaveLength(1);
  });

  it('broadcasts turn_error with the operation ID and frees the guard when resolution fails', async () => {
    await insertSessionState(makeTestSession({ id: 'route-error' }));
    mockGenerateTurn.mockRejectedValueOnce(Object.assign(new Error('slow down'), { status: 429 }));

    let response: Response | undefined;
    const events = await waitForConnected('route-error', async () => {
      response = await postAction('route-error', { action: 'Charge', statUsed: 'might', requestId: 'err-1' });
    }, event => event.type === 'turn_error');
    const accepted = await response!.json() as { operation: SessionOperation };
    const error = events.find(e => e.type === 'turn_error')!;
    expect(error).toMatchObject({ error: 'rate_limit', operationId: accepted.operation.id });
    expect(operationRepository.get('route-error', accepted.operation.id)).toMatchObject({ status: 'failed', errorCode: 'rate_limit' });
    expect(stateRow('route-error').revision).toBe(0);

    const retry = await postAction('route-error', { action: 'Charge', statUsed: 'might', requestId: 'err-2' });
    expect(retry.status).toBe(202);
  });

  it('rejects invalid input before acceptance', async () => {
    await insertSessionState(makeTestSession({ id: 'route-invalid' }));
    const tooLong = await postAction('route-invalid', { action: 'x'.repeat(601), statUsed: 'might' });
    expect(tooLong.status).toBe(400);
    const badStat = await postAction('route-invalid', { action: 'Dance', statUsed: 'charisma' });
    expect(badStat.status).toBe(400);
    expect(operationRepository.getLatest('route-invalid')).toBeNull();
  });

  it('stores the "Suggest ideas each turn" realm setting as a guarded settings patch', async () => {
    await insertSessionState(makeTestSession({ id: 'route-auto-ideas' }));
    const patch = (body: Record<string, unknown>) => fetch(`${baseUrl}/session/route-auto-ideas`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const on = await patch({ autoIdeas: true, expectedRevision: 0 });
    expect(on.status).toBe(200);
    expect(await on.json()).toMatchObject({ autoIdeas: true, revision: 1 });
    expect((await (await fetch(`${baseUrl}/session/route-auto-ideas`)).json() as { autoIdeas?: boolean }).autoIdeas).toBe(true);

    await patch({ autoIdeas: false, expectedRevision: 1 });
    expect((await StateService.getSession('route-auto-ideas'))?.autoIdeas).toBeUndefined();
    expect((await patch({ autoIdeas: 'yes' })).status).toBe(400);
  });

  it('never sends riddle correctness to clients, only the public riddle marker', async () => {
    const riddleChoices = [
      { label: 'Answer: a piano', difficulty: 'normal' as const, stat: 'magic' as const, difficultyValue: 12, riddleAnswer: 'a piano', riddleCorrect: true },
      { label: 'Answer: a jailer', difficulty: 'normal' as const, stat: 'magic' as const, difficultyValue: 12, riddleAnswer: 'a jailer', riddleCorrect: false },
      { label: 'Search the door frame', difficulty: 'easy' as const, stat: 'mischief' as const, difficultyValue: 8 },
    ];
    await insertSessionState(makeTestSession({ id: 'route-riddle-private' }));
    await StateService.addTurnResult('route-riddle-private', { ...makeTurn('The door sings a riddle.'), choices: riddleChoices }, null);
    resetMockNarrationProvider({ ...FIXED_NARRATION_OUTPUT, choices: riddleChoices } as typeof FIXED_NARRATION_OUTPUT);

    const events = await waitForConnected('route-riddle-private', async () => {
      await postAction('route-riddle-private', { action: 'Hum at the door', statUsed: 'magic', requestId: 'riddle-private-1' });
    }, event => event.type === 'turn_complete');
    const complete = events.find(e => e.type === 'turn_complete')!;
    const bodies = [
      JSON.stringify(complete),
      await (await fetch(`${baseUrl}/session/route-riddle-private/history`)).text(),
      await (await fetch(`${baseUrl}/session/route-riddle-private/snapshot`)).text(),
      await (await fetch(`${baseUrl}/session/route-riddle-private`)).text(),
    ];
    for (const body of bodies) {
      expect(body).not.toContain('riddleAnswer');
      expect(body).not.toContain('riddleCorrect');
      expect(body).toContain('"kind":"riddle_answer"');
    }
    // The server still resolves riddles from its own copy.
    const stored = await StateService.getTurnHistory('route-riddle-private');
    expect(stored[0].choices[0]).toMatchObject({ riddleAnswer: 'a piano', riddleCorrect: true });
  });

  it('rejects a confirmed preview once the story has moved on', async () => {
    await insertSessionState(makeTestSession({ id: 'route-preview' }));
    const { storeActionPreview } = await import('../../services/actionPreviewStore.js');
    const previewId = storeActionPreview({ sessionId: 'route-preview', revision: 0, actingCharacterId: 'char-pip', kind: 'free_text', originalAction: 'Juggle knives', interpretedAction: 'Juggle knives', stat: 'mischief', difficulty: 'hard', difficultyValue: 16 });
    StateService.bumpRevision('route-preview');
    const res = await postAction('route-preview', { action: 'Juggle knives', statUsed: 'might', difficulty: 'easy', previewId });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'stale_preview' });
  });

  it('rejects a confirmation whose text or kind no longer matches its preview', async () => {
    await insertSessionState(makeTestSession({ id: 'route-preview-mismatch' }));
    const { storeActionPreview } = await import('../../services/actionPreviewStore.js');
    const previewId = storeActionPreview({ sessionId: 'route-preview-mismatch', revision: 0, actingCharacterId: 'char-pip', kind: 'free_text', originalAction: 'Juggle knives', interpretedAction: 'Pip juggles knives', stat: 'mischief', difficulty: 'hard', difficultyValue: 16 });
    const edited = await postAction('route-preview-mismatch', { action: 'Throw the knives', statUsed: 'mischief', previewId, requestId: 'mismatch-1' });
    expect(edited.status).toBe(409);
    expect(await edited.json()).toMatchObject({ error: 'preview_mismatch' });
    const asItem = await postAction('route-preview-mismatch', { action: 'Juggle knives', statUsed: 'none', actionType: 'use_item', itemId: 'knives', previewId, requestId: 'mismatch-2' });
    expect(asItem.status).toBe(409);
    expect(await asItem.json()).toMatchObject({ error: 'preview_mismatch' });
    expect(operationRepository.getLatest('route-preview-mismatch')).toBeNull();
  });

  it('rejects a previewed item action once the item is gone, keeping it retryable', async () => {
    await insertSessionState(makeTestSession({ id: 'route-preview-item' }));
    const { storeActionPreview } = await import('../../services/actionPreviewStore.js');
    const previewId = storeActionPreview({ sessionId: 'route-preview-item', revision: 0, actingCharacterId: 'char-pip', kind: 'item_use', originalAction: 'Drink the potion', interpretedAction: 'Pip drinks the healing potion', itemId: 'item-already-used', itemOwnerCharacterId: 'char-pip', stat: 'might', difficulty: 'normal' });
    const res = await postAction('route-preview-item', { action: 'Pip drinks the healing potion', statUsed: 'none', previewId });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'item_unavailable' });
    expect(operationRepository.getLatest('route-preview-item')).toBeNull();
  });

  it('resolves a suggestion by stable id with server-owned mechanics and rejects stale ids', async () => {
    await insertSessionState(makeTestSession({ id: 'route-choice-id' }));
    await StateService.addTurnResult('route-choice-id', {
      ...makeTurn('A locked door.'),
      choices: [
        { label: 'Kick the door', stat: 'might', difficulty: 'normal', difficultyValue: 12 },
        { label: 'Charm the lock', stat: 'magic', difficulty: 'easy', difficultyValue: 8 },
      ],
    }, null);
    const [kick, charm] = (await StateService.getTurnHistory('route-choice-id'))[0].choices;
    expect(kick.id).toBeTypeOf('number');

    // The client echoes the wrong stat; the stored descriptor wins.
    const res = await postAction('route-choice-id', { action: charm.label, statUsed: 'might', difficulty: 'hard', choiceId: charm.id, requestId: 'choice-1' });
    expect(res.status).toBe(202);
    await vi.waitFor(async () => {
      expect((await (await fetch(`${baseUrl}/session/route-choice-id/snapshot`)).json() as SessionSnapshot).activeOperation).toBeNull();
    });
    const history = await StateService.getTurnHistory('route-choice-id');
    expect(history[1].lastAction?.actionResult).toMatchObject({ statUsed: 'magic', difficultyTarget: 8 });
    // New suggestions carry fresh ids.
    expect(history[1].choices.every(c => typeof c.id === 'number' && c.id !== kick.id)).toBe(true);

    const stale = await postAction('route-choice-id', { action: kick.label, statUsed: 'might', choiceId: kick.id, requestId: 'choice-2' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'stale_choice' });
  });

  it('rejects settings patches while an operation is pending', async () => {
    await insertSessionState(makeTestSession({ id: 'route-patch' }));
    acceptSessionOperation({ sessionId: 'route-patch', namespaceId: 'local', kind: 'action', requestId: 'busy', payload: {} });
    const res = await fetch(`${baseUrl}/session/route-patch`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty: 'hard' }),
    });
    expect(res.status).toBe(409);
    expect((await StateService.getSession('route-patch'))?.difficulty).toBe('normal');
  });
});
