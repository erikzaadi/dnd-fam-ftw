import { useCallback, useMemo, useRef, useState } from 'react';
import type { SessionOperation, SessionSnapshot } from '../types';
import type { OperationEventMeta } from '../hooks/useSessionEvents';
import { fetchSessionSnapshot, isOperationPending, submitSessionOperation, type SubmitOperationResult } from './sessionOperations';

// Operation lifecycle, orthogonal to the SSE connection state (a reconnect is not a turn):
//   idle        - nothing pending; the view may accept input
//   submitting  - request in flight, not yet accepted by the server
//   resolving   - accepted; waiting for the committed turn (or an error)
//   following_up - a turn committed but the same operation continues with a rescue
//                  (party wipe) or an ending; the view stays locked until it lands
export type OperationPhase = 'idle' | 'submitting' | 'resolving' | 'following_up';

export type SessionOperationsOptions = {
  sessionId: string | undefined;
  // Apply an authoritative snapshot (session + history) to the view.
  onSnapshot: (snapshot: SessionSnapshot) => void;
  // Lock or unlock the view's action input.
  setBusy: (busy: boolean) => void;
  // Whether the view currently shows a busy state (used when an event was missed).
  isBusy: () => boolean;
  // The operation this view was waiting on finished while its events were missed.
  // failed is set when it ended in failure, so the view can show why.
  onWaitEnded: (failed: SessionOperation | null) => void;
};

// Shared by the ordinary Session page and the car/terminal runtime: revision
// tracking, pending-operation bookkeeping, snapshot reconciliation and guarded
// submission. Presentation (rolls, banners, speech) stays in the views.
export function useSessionOperations(options: SessionOperationsOptions) {
  // SSE handlers are registered once per session, so everything here reads refs.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const revisionRef = useRef(0);
  const pendingOperationRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const followUpRef = useRef(false);
  const [phase, setPhase] = useState<OperationPhase>('idle');

  const noteRevision = useCallback((revision: number | undefined) => {
    if (revision !== undefined) {
      revisionRef.current = Math.max(revisionRef.current, revision);
    }
  }, []);

  // Fetch the authoritative snapshot and resolve any stale busy state from operation
  // status. Called on every (re)connection and after conflicts.
  const reconcile = useCallback(async () => {
    const { sessionId } = optionsRef.current;
    if (!sessionId) {
      return;
    }
    const snapshot = await fetchSessionSnapshot(sessionId);
    if (!snapshot || snapshot.revision < revisionRef.current) {
      return;
    }
    revisionRef.current = snapshot.revision;
    optionsRef.current.onSnapshot(snapshot);

    if (snapshot.activeOperation && isOperationPending(snapshot.activeOperation)) {
      pendingOperationRef.current = snapshot.activeOperation.id;
      followUpRef.current = snapshot.activeOperation.phase === 'recovering' || snapshot.activeOperation.phase === 'concluding';
      setPhase(followUpRef.current ? 'following_up' : 'resolving');
      optionsRef.current.setBusy(true);
      return;
    }
    if (submittingRef.current) {
      return;
    }
    const waitedFor = pendingOperationRef.current;
    pendingOperationRef.current = null;
    followUpRef.current = false;
    if (waitedFor || optionsRef.current.isBusy()) {
      setPhase('idle');
      const latest = snapshot.latestOperation;
      optionsRef.current.onWaitEnded(latest && latest.id === waitedFor && latest.status === 'failed' ? latest : null);
    }
  }, [setPhase]);

  // POST a mutation with the current revision and an idempotency key. On acceptance
  // the operation becomes pending; a conflict refreshes the snapshot (drafts live in
  // the views and are untouched).
  const submit = useCallback(async (
    path: string,
    body: Record<string, unknown>,
    submitOptions: { expectsFollowUp?: boolean } = {},
  ): Promise<SubmitOperationResult> => {
    submittingRef.current = true;
    setPhase('submitting');
    try {
      const result = await submitSessionOperation(path, { ...body, expectedRevision: revisionRef.current });
      if (result.kind === 'accepted') {
        pendingOperationRef.current = result.operation.id;
        followUpRef.current = !!submitOptions.expectsFollowUp;
        setPhase(followUpRef.current ? 'following_up' : 'resolving');
        if (result.replayed && !isOperationPending(result.operation)) {
          void reconcile();
        }
        return result;
      }
      setPhase('idle');
      if (result.status === 409) {
        void reconcile();
      }
      return result;
    } catch (err) {
      setPhase('idle');
      throw err;
    } finally {
      submittingRef.current = false;
    }
  }, [reconcile, setPhase]);

  // A turn committed. Returns true when the same operation continues (rescue or
  // ending), in which case the view should stay locked.
  const onTurnCommitted = useCallback((meta?: OperationEventMeta): boolean => {
    noteRevision(meta?.revision);
    if (meta?.recovering || meta?.concluding) {
      followUpRef.current = true;
      setPhase('following_up');
      return true;
    }
    pendingOperationRef.current = null;
    followUpRef.current = false;
    setPhase('idle');
    return false;
  }, [noteRevision, setPhase]);

  // The operation ended: its follow-up turn arrived, it failed, or the game ended.
  const onOperationEnded = useCallback((meta?: OperationEventMeta) => {
    noteRevision(meta?.revision);
    pendingOperationRef.current = null;
    followUpRef.current = false;
    setPhase('idle');
  }, [noteRevision, setPhase]);

  const isAwaitingFollowUp = useCallback(() => followUpRef.current, []);

  // Stable identity except when the phase changes, so views can list it as a dependency.
  return useMemo(() => ({
    phase,
    revisionRef,
    noteRevision,
    reconcile,
    submit,
    onTurnCommitted,
    onOperationEnded,
    isAwaitingFollowUp,
  }), [phase, noteRevision, reconcile, submit, onTurnCommitted, onOperationEnded, isAwaitingFollowUp]);
}
