import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionOperation, SessionSnapshot } from '../types';
import { useSessionOperations } from './useSessionOperations';

const mocks = vi.hoisted(() => ({
  fetchSessionSnapshot: vi.fn(),
  submitSessionOperation: vi.fn(),
}));

vi.mock('./sessionOperations', () => ({
  fetchSessionSnapshot: mocks.fetchSessionSnapshot,
  submitSessionOperation: mocks.submitSessionOperation,
  isOperationPending: (op: SessionOperation | null | undefined) => op?.status === 'accepted' || op?.status === 'running',
}));

const operation = (overrides: Partial<SessionOperation> = {}): SessionOperation => ({
  id: 'op-1',
  requestId: 'req-1',
  kind: 'action',
  status: 'running',
  baseRevision: 3,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const snapshot = (overrides: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  revision: 4,
  session: { id: 's1' } as SessionSnapshot['session'],
  history: [],
  activeOperation: null,
  latestOperation: null,
  ...overrides,
});

const setup = (busy = false) => {
  const handlers = {
    onSnapshot: vi.fn(),
    setBusy: vi.fn(),
    isBusy: vi.fn(() => busy),
    onWaitEnded: vi.fn(),
  };
  const hook = renderHook(() => useSessionOperations({ sessionId: 's1', ...handlers }));
  return { hook, handlers };
};

beforeEach(() => {
  mocks.fetchSessionSnapshot.mockReset();
  mocks.submitSessionOperation.mockReset();
});

describe('useSessionOperations', () => {
  it('locks the view when the snapshot shows an operation still running, including follow-ups', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot({ activeOperation: operation({ phase: 'concluding' }) }));
    const { hook, handlers } = setup();
    await act(() => hook.result.current.reconcile());
    expect(handlers.onSnapshot).toHaveBeenCalled();
    expect(handlers.setBusy).toHaveBeenCalledWith(true);
    expect(hook.result.current.phase).toBe('following_up');
    expect(hook.result.current.isAwaitingFollowUp()).toBe(true);
    expect(hook.result.current.revisionRef.current).toBe(4);
  });

  it('reports the failure of an operation whose events were missed', async () => {
    mocks.submitSessionOperation.mockResolvedValue({ kind: 'accepted', operation: operation(), replayed: false });
    const { hook, handlers } = setup();
    await act(async () => {
      await hook.result.current.submit('/session/s1/action', { action: 'Charge' });
    });
    expect(hook.result.current.phase).toBe('resolving');

    const failed = operation({ status: 'failed', errorCode: 'interrupted', errorMessage: 'Server restarted' });
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot({ latestOperation: failed }));
    await act(() => hook.result.current.reconcile());
    expect(handlers.onWaitEnded).toHaveBeenCalledWith(failed);
    expect(hook.result.current.phase).toBe('idle');
  });

  it('stays idle when the turn commits before the POST that started it returns', async () => {
    let accept: (value: unknown) => void = () => undefined;
    mocks.submitSessionOperation.mockReturnValue(new Promise(resolve => {
      accept = resolve;
    }));
    const { hook } = setup();
    let submitted: Promise<unknown> = Promise.resolve();
    act(() => {
      submitted = hook.result.current.submit('/session/s1/action', { action: 'Charge' });
    });
    expect(hook.result.current.phase).toBe('submitting');

    // A fast DM: turn_complete arrives first, then the 202.
    act(() => {
      hook.result.current.onTurnCommitted({ operationId: 'op-1', revision: 4 });
    });
    await act(async () => {
      accept({ kind: 'accepted', operation: operation({ status: 'completed' }), replayed: false });
      await submitted;
    });
    expect(hook.result.current.phase).toBe('idle');
  });

  it('sends the known revision and refreshes after a conflict', async () => {
    mocks.submitSessionOperation.mockResolvedValue({ kind: 'rejected', status: 409, error: 'stale_revision', message: 'moved on' });
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot());
    const { hook } = setup();
    act(() => hook.result.current.noteRevision(3));
    await act(async () => {
      await hook.result.current.submit('/session/s1/action', { action: 'Charge' });
    });
    expect(mocks.submitSessionOperation).toHaveBeenCalledWith('/session/s1/action', { action: 'Charge', expectedRevision: 3 });
    expect(mocks.fetchSessionSnapshot).toHaveBeenCalledWith('s1');
    expect(hook.result.current.phase).toBe('idle');
  });

  it('stays locked through a rescue follow-up and unlocks when it lands', async () => {
    const { hook } = setup();
    let followUp = false;
    act(() => {
      followUp = hook.result.current.onTurnCommitted({ revision: 5, recovering: true });
    });
    expect(followUp).toBe(true);
    expect(hook.result.current.phase).toBe('following_up');
    act(() => hook.result.current.onOperationEnded({ revision: 6 }));
    expect(hook.result.current.phase).toBe('idle');
    expect(hook.result.current.revisionRef.current).toBe(6);
  });

  it('ignores a snapshot older than what the view already applied', async () => {
    mocks.fetchSessionSnapshot.mockResolvedValue(snapshot({ revision: 2 }));
    const { hook, handlers } = setup();
    act(() => hook.result.current.noteRevision(5));
    await act(() => hook.result.current.reconcile());
    expect(handlers.onSnapshot).not.toHaveBeenCalled();
  });
});
