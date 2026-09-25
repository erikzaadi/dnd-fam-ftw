import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, SessionOperation, TurnResult } from '../types';
import { useSessionRuntime, type SessionRuntimePresenter } from './useSessionRuntime';

type Handlers = Record<string, (...args: unknown[]) => void>;

const mocks = vi.hoisted(() => ({
  handlers: {} as Handlers,
  apiFetch: vi.fn(),
  fetchSessionSnapshot: vi.fn(),
  submitSessionOperation: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../lib/api', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('../hooks/useSessionEvents', () => ({
  useSessionEvents: (handlers: Handlers) => {
    mocks.handlers = handlers;
    return { connectionState: 'connected' };
  },
}));
vi.mock('./sessionOperations', () => ({
  fetchSessionSnapshot: mocks.fetchSessionSnapshot,
  submitSessionOperation: mocks.submitSessionOperation,
  isOperationPending: (op: SessionOperation | null | undefined) => op?.status === 'accepted' || op?.status === 'running',
}));

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 's1',
  revision: 3,
  activeCharacterId: 'c1',
  party: [{ id: 'c1', name: 'Pip', inventory: [] }],
  ...overrides,
} as unknown as Session);

const turn = (id: number, overrides: Partial<TurnResult> = {}): TurnResult => ({
  id,
  narration: `Turn ${id}`,
  choices: [],
  ...overrides,
} as unknown as TurnResult);

const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });

const operation = (overrides: Partial<SessionOperation> = {}): SessionOperation => ({
  id: 'op-1',
  requestId: 'req-1',
  kind: 'action',
  status: 'accepted',
  baseRevision: 3,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const setup = async (presenter: SessionRuntimePresenter = {}, history: TurnResult[] = [turn(1)]) => {
  mocks.apiFetch.mockImplementation((path: string) => {
    if (path === '/session/s1') {
      return json(session());
    }
    if (path === '/session/s1/history') {
      return json(history);
    }
    return json({});
  });
  const hook = renderHook(() => useSessionRuntime({ sessionId: 's1', presenter }));
  await waitFor(() => expect(hook.result.current.turnPhase).toBe('ready'));
  return hook;
};

beforeEach(() => {
  mocks.handlers = {};
  mocks.apiFetch.mockReset();
  mocks.fetchSessionSnapshot.mockReset();
  mocks.submitSessionOperation.mockReset();
  mocks.navigate.mockReset();
});

describe('useSessionRuntime', () => {
  it('loads the session and history, and reports the first load to the view', async () => {
    const onHistoryLoaded = vi.fn();
    const hook = await setup({ onHistoryLoaded });
    expect(hook.result.current.history).toHaveLength(1);
    expect(onHistoryLoaded).toHaveBeenCalledWith([turn(1)], expect.objectContaining({ initial: true, wasEmpty: true }));
  });

  it('goes back home when the session does not exist', async () => {
    mocks.apiFetch.mockImplementation(() => json({}, false));
    renderHook(() => useSessionRuntime({ sessionId: 's1' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/'));
  });

  it('walks one action through submitting, resolving, revealing and presenting', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const onTurnComplete = vi.fn(() => 600);
      const hook = await setup({ onTurnComplete });
      mocks.submitSessionOperation.mockResolvedValue({ kind: 'accepted', operation: operation(), replayed: false });

      await act(async () => {
        const result = await hook.result.current.submitTurn({ action: 'Pip sneaks past the cook', statUsed: 'mischief' });
        expect(result).toEqual({ ok: true });
      });
      expect(mocks.submitSessionOperation).toHaveBeenCalledTimes(1);
      expect(mocks.submitSessionOperation.mock.calls[0][1]).toMatchObject({ action: 'Pip sneaks past the cook', statUsed: 'mischief', expectedRevision: 3 });
      expect(hook.result.current.turnPhase).toBe('resolving');
      expect(hook.result.current.busy).toBe(true);

      act(() => mocks.handlers.onRollNarrationDone(null, { roll: 14, success: true, statUsed: 'mischief' }));
      expect(hook.result.current.turnPhase).toBe('revealing');

      act(() => mocks.handlers.onTurnComplete(session({ revision: 4 }), turn(2), { revision: 4 }));
      expect(hook.result.current.history.map(t => t.id)).toEqual([1, 2]);
      expect(hook.result.current.turnPhase).toBe('presenting');
      expect(onTurnComplete).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }), turn(2), { followUp: false });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(hook.result.current.turnPhase).toBe('ready');
      expect(hook.result.current.busy).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds a turn once when its event arrives twice', async () => {
    const onTurnAppended = vi.fn();
    const hook = await setup({ onTurnAppended });
    act(() => {
      mocks.handlers.onTurnComplete(session({ revision: 4 }), turn(2), { revision: 4 });
      mocks.handlers.onTurnComplete(session({ revision: 4 }), turn(2), { revision: 4 });
    });
    expect(hook.result.current.history.map(t => t.id)).toEqual([1, 2]);
    expect(onTurnAppended).toHaveBeenCalledTimes(1);
    expect(onTurnAppended).toHaveBeenCalledWith(turn(2), 1);
  });

  it('locks for a turn another viewer submitted, until it lands', async () => {
    const hook = await setup();
    act(() => mocks.handlers.onNarrating({ action: 'Someone else acts' }));
    expect(hook.result.current.turnPhase).toBe('resolving');
    act(() => mocks.handlers.onTurnComplete(session({ revision: 4 }), turn(2), { revision: 4 }));
    expect(hook.result.current.turnPhase).toBe('ready');
  });

  it('stays in recovering until the rescue turn closes the operation', async () => {
    const onFollowUpTurn = vi.fn();
    const hook = await setup({ onFollowUpTurn });
    act(() => mocks.handlers.onNarrating({}));
    act(() => mocks.handlers.onTurnComplete(session({ revision: 4 }), turn(2), { revision: 4, recovering: true }));
    expect(hook.result.current.turnPhase).toBe('recovering');

    act(() => mocks.handlers.onIntervention('A dragon swoops in', session({ revision: 5 }), turn(3), { revision: 5 }));
    expect(hook.result.current.turnPhase).toBe('ready');
    expect(hook.result.current.history.map(t => t.id)).toEqual([1, 2, 3]);
    expect(onFollowUpTurn).toHaveBeenCalledWith('intervention', 'A dragon swoops in', expect.anything(), turn(3));
  });

  it('drops a scene preview when a setting changes, so nothing stale is confirmed', async () => {
    const hook = await setup();
    mocks.apiFetch.mockImplementationOnce(() => json({ interpretedAction: 'Pip rallies the party', stat: 'magic', difficulty: 'normal', previewId: 'p-1' }));
    await act(() => hook.result.current.previewSceneAction({ intent: 'party_boost' }));
    expect(hook.result.current.turnPhase).toBe('confirming');
    expect(hook.result.current.actionPreview).toMatchObject({ previewId: 'p-1', pendingIntent: 'party_boost' });

    act(() => mocks.handlers.onSessionUpdated(4, { difficulty: 'hard' }));
    expect(hook.result.current.actionPreview).toBeNull();
    expect(hook.result.current.turnPhase).toBe('ready');

    // The dropped preview's handle is not sent with a later action of the same text.
    mocks.submitSessionOperation.mockResolvedValue({ kind: 'accepted', operation: operation(), replayed: false });
    await act(async () => {
      await hook.result.current.submitTurn({ action: 'Pip rallies the party' });
    });
    expect(mocks.submitSessionOperation.mock.calls[0][1]).not.toHaveProperty('previewId');
  });

  it('keeps a failed turn readable and unlocks the view', async () => {
    const onTurnError = vi.fn();
    const hook = await setup({ onTurnError });
    mocks.submitSessionOperation.mockResolvedValue({ kind: 'accepted', operation: operation(), replayed: false });
    await act(async () => {
      await hook.result.current.submitTurn({ action: 'Charge' });
    });
    act(() => mocks.handlers.onTurnError('turn_failed', 'The DM lost the thread', { revision: 3 }));
    expect(hook.result.current.turnPhase).toBe('ready');
    expect(hook.result.current.actionError).toBe('The DM lost the thread');
    expect(onTurnError).toHaveBeenCalledWith('turn_failed', 'The DM lost the thread');
  });

  it('returns a refusal without locking the view', async () => {
    const hook = await setup();
    mocks.submitSessionOperation.mockResolvedValue({ kind: 'rejected', status: 409, error: 'stale_choice', message: 'Pick from the latest options.' });
    mocks.fetchSessionSnapshot.mockResolvedValue(null);
    let result: unknown;
    await act(async () => {
      result = await hook.result.current.submitTurn({ action: 'Old idea', choiceId: 7 });
    });
    expect(result).toEqual({ ok: false, error: 'stale_choice', message: 'Pick from the latest options.' });
    expect(hook.result.current.turnPhase).toBe('ready');
    expect(hook.result.current.actionError).toBe('Pick from the latest options.');
  });

  it('reconciles on reconnect and ends a wait whose events were missed', async () => {
    const onWaitEnded = vi.fn();
    const hook = await setup({ onWaitEnded });
    mocks.submitSessionOperation.mockResolvedValue({ kind: 'accepted', operation: operation(), replayed: false });
    await act(async () => {
      await hook.result.current.submitTurn({ action: 'Charge' });
    });
    expect(hook.result.current.busy).toBe(true);

    mocks.fetchSessionSnapshot.mockResolvedValue({
      revision: 4,
      session: session({ revision: 4 }),
      history: [turn(1), turn(2)],
      activeOperation: null,
      latestOperation: operation({ status: 'completed' }),
    });
    await act(async () => {
      mocks.handlers.onConnected();
    });
    await waitFor(() => expect(hook.result.current.turnPhase).toBe('ready'));
    expect(hook.result.current.history.map(t => t.id)).toEqual([1, 2]);
    expect(onWaitEnded).toHaveBeenCalledWith(null);
  });
});
