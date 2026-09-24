import { withTransaction } from '../persistence/transaction.js';
import { operationRepository, toPublicOperation } from '../repositories/operationRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import type { OperationConflictCode, SessionOperation } from '../types.js';

export type GuardedMutationResult =
  | { ok: true; revision: number }
  | {
      ok: false;
      status: 404 | 409;
      body: { error: OperationConflictCode | 'not_found'; message: string; currentRevision?: number; activeOperation?: SessionOperation | null };
    };

// Settings, lifecycle and character writes outside a turn. They follow the same rules
// as gameplay operations: rejected while an operation is pending (the player's draft
// stays in the client), rejected on a stale revision, and they bump the revision so
// previews computed against the old state are invalidated. write must be synchronous.
export const applyGuardedSessionMutation = (
  sessionId: string,
  expectedRevision: number | undefined,
  write: () => void,
): GuardedMutationResult => withTransaction((): GuardedMutationResult => {
  const revision = sessionRepository.getRevision(sessionId);
  if (revision === undefined) {
    return { ok: false, status: 404, body: { error: 'not_found', message: 'Session not found' } };
  }
  const active = operationRepository.getActive(sessionId);
  if (active) {
    return {
      ok: false,
      status: 409,
      body: {
        error: 'operation_in_progress',
        message: 'An action is still being resolved. Try again once it finishes.',
        currentRevision: revision,
        activeOperation: toPublicOperation(active),
      },
    };
  }
  if (expectedRevision !== undefined && expectedRevision !== revision) {
    return {
      ok: false,
      status: 409,
      body: {
        error: 'stale_revision',
        message: 'The session changed since you opened this. Check the latest settings and try again.',
        currentRevision: revision,
      },
    };
  }
  write();
  return { ok: true, revision: sessionRepository.bumpRevision(sessionId) };
});
