import { createHash } from 'crypto';
import type { Response } from 'express';
import { createId } from '../lib/ids.js';
import { broadcastUpdate } from '../realtime/sessionEvents.js';
import {
  operationRepository,
  toPublicOperation,
  type AcceptOperationInput,
  type AcceptOperationResult,
  type StoredOperation,
} from '../repositories/operationRepository.js';
import { StaleRevisionError } from '../repositories/turnCommitRepository.js';
import type { OperationAcceptedResponse, SessionOperationKind } from '../types.js';

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
};

export const hashOperationPayload = (payload: unknown): string =>
  createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');

// Clients that predate request IDs still pass through the guard with a server-made ID.
// They lose replay protection only, never the single-operation guarantee.
export const resolveRequestId = (requestId: string | undefined): string =>
  requestId ?? `server-${createId()}`;

// A retried request (lost response) must get its original outcome even when the
// session state has since changed (e.g. the adventure it ended is now completed).
// Call before route-level state checks; returns true when a response was sent.
export const respondIfKnownRequest = (res: Response, params: {
  sessionId: string;
  namespaceId: string;
  kind: SessionOperationKind;
  requestId?: string;
  payload: unknown;
}): boolean => {
  if (!params.requestId || !operationRepository.getByRequestId(params.sessionId, params.requestId)) {
    return false;
  }
  respondToAcceptance(res, acceptSessionOperation(params));
  return true;
};

export const acceptSessionOperation = (params: {
  sessionId: string;
  namespaceId: string;
  kind: SessionOperationKind;
  requestId?: string;
  expectedRevision?: number;
  payload: unknown;
  precondition?: AcceptOperationInput['precondition'];
}): AcceptOperationResult => operationRepository.accept({
  sessionId: params.sessionId,
  namespaceId: params.namespaceId,
  kind: params.kind,
  requestId: resolveRequestId(params.requestId),
  expectedRevision: params.expectedRevision,
  payloadHash: hashOperationPayload(params.payload),
  precondition: params.precondition,
});

export type AcceptanceOutcome = {
  status: number;
  body: Record<string, unknown>;
  // Set only when new work was accepted and must now be run.
  operation: StoredOperation | null;
};

// Transport-neutral result of an acceptance attempt (REST and MCP).
export const describeAcceptance = (result: AcceptOperationResult): AcceptanceOutcome => {
  if (result.type === 'missing') {
    return { status: 404, body: { error: 'Session not found' }, operation: null };
  }
  if (result.type === 'conflict') {
    return {
      status: 409,
      body: {
        error: result.code,
        message: result.message,
        currentRevision: result.currentRevision,
        ...(result.activeOperation && { activeOperation: toPublicOperation(result.activeOperation) }),
      },
      operation: null,
    };
  }
  const operation = toPublicOperation(result.operation)!;
  if (result.type === 'replay') {
    const body: OperationAcceptedResponse = {
      queued: operation.status === 'accepted' || operation.status === 'running',
      replayed: true,
      operation,
    };
    return { status: 200, body: body as unknown as Record<string, unknown>, operation: null };
  }
  const body: OperationAcceptedResponse = { queued: true, operation };
  return { status: 202, body: body as unknown as Record<string, unknown>, operation: result.operation };
};

// Sends the HTTP response for an acceptance attempt. Returns the operation to run
// when (and only when) new work was accepted.
export const respondToAcceptance = (res: Response, result: AcceptOperationResult): StoredOperation | null => {
  const outcome = describeAcceptance(result);
  res.status(outcome.status).json(outcome.body);
  return outcome.operation;
};

export type OperationFailure = {
  error: string;
  message: string;
};

const describeError = (error: unknown): OperationFailure => {
  if (error instanceof StaleRevisionError) {
    return {
      error: 'stale_revision',
      message: 'The story changed while this action was resolving. Check the latest scene and try again.',
    };
  }
  if ((error as { status?: number })?.status === 429) {
    return {
      error: 'rate_limit',
      message: 'The AI is overwhelmed with requests. Wait a moment and try again.',
    };
  }
  return { error: 'turn_failed', message: 'Something went wrong. Please try again.' };
};

export const failSessionOperation = (sessionId: string, operationId: string, failure: OperationFailure): void => {
  const failed = operationRepository.fail(operationId, failure.error, failure.message);
  // Only announce failure if this call actually ended the operation.
  if (failed?.status === 'failed' && failed.errorCode === failure.error) {
    broadcastUpdate(sessionId, 'turn_error', {
      ...failure,
      operationId,
      operation: toPublicOperation(failed),
    });
  }
};

// Runs accepted work. The work is responsible for committing (which completes the
// operation atomically). Anything that returns or throws without completing it is
// recorded as an explicit failure so no view is left waiting.
export const runSessionOperation = async (
  operation: StoredOperation,
  work: () => Promise<OperationFailure | void>,
): Promise<void> => {
  operationRepository.markRunning(operation.id);
  try {
    const failure = await work();
    if (failure) {
      failSessionOperation(operation.sessionId, operation.id, failure);
      return;
    }
  } catch (error) {
    console.error(`[Operation] ${operation.kind} failed session=${operation.sessionId} operation=${operation.id}`, error);
    failSessionOperation(operation.sessionId, operation.id, describeError(error));
    return;
  }
  const after = operationRepository.get(operation.sessionId, operation.id);
  if (after && (after.status === 'accepted' || after.status === 'running')) {
    console.error(`[Operation] ${operation.kind} finished without committing session=${operation.sessionId} operation=${operation.id}`);
    failSessionOperation(operation.sessionId, operation.id, { error: 'turn_failed', message: 'Something went wrong. Please try again.' });
  }
};

export const reconcileInterruptedOperations = (): void => {
  const count = operationRepository.failInterrupted();
  if (count > 0) {
    console.warn(`[Operation] Marked ${count} interrupted operation(s) failed after restart`);
  }
};
