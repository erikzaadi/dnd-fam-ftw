import type { OperationAcceptedResponse, SessionOperation, SessionSnapshot } from '../types';
import { apiFetch } from '../lib/api';

export const createRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export type SubmitOperationResult =
  | { kind: 'accepted'; operation: SessionOperation; replayed: boolean }
  | { kind: 'rejected'; status: number; error: string; message: string; currentRevision?: number };

const REJECTION_MESSAGES: Record<string, string> = {
  operation_in_progress: 'Another action is still being resolved. Wait for it to finish, then try again.',
  stale_revision: 'The story moved on since you chose this. Check the latest scene and try again.',
  stale_preview: 'The scene changed since this action was previewed. Review it again before confirming.',
  stale_choice: 'That option is from an earlier moment in the story. Pick from the latest options.',
  adventure_completed: 'This adventure has ended. Continue the world to start a new chapter.',
};

// POSTs a mutation with an idempotency key. A network failure (lost request or lost
// response) is retried once with the same request ID, so the server either starts
// the work once or returns the operation it already accepted - never a second roll.
export const submitSessionOperation = async (
  path: string,
  body: Record<string, unknown>,
  requestId: string = createRequestId(),
): Promise<SubmitOperationResult> => {
  const payload = JSON.stringify({ ...body, requestId });
  const send = () => apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });

  let res: Response;
  try {
    res = await send();
  } catch {
    res = await send();
  }
  const data = await res.json().catch(() => ({})) as Partial<OperationAcceptedResponse> & { error?: string; message?: string; currentRevision?: number };
  if (res.ok && data.operation) {
    return { kind: 'accepted', operation: data.operation, replayed: !!data.replayed };
  }
  const error = data.error ?? 'turn_failed';
  return {
    kind: 'rejected',
    status: res.status,
    error,
    message: REJECTION_MESSAGES[error] ?? data.message ?? 'Action failed',
    ...(data.currentRevision !== undefined && { currentRevision: data.currentRevision }),
  };
};

export const fetchSessionSnapshot = async (sessionId: string): Promise<SessionSnapshot | null> => {
  try {
    const res = await apiFetch(`/session/${sessionId}/snapshot`);
    if (!res.ok) {
      return null;
    }
    return await res.json() as SessionSnapshot;
  } catch {
    return null;
  }
};

export const isOperationPending = (operation: SessionOperation | null | undefined): boolean =>
  operation?.status === 'accepted' || operation?.status === 'running';
