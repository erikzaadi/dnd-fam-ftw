import { createId } from '../lib/ids.js';
import { getDb } from '../persistence/database.js';
import { withTransaction } from '../persistence/transaction.js';
import type {
  OperationConflictCode,
  SessionOperation,
  SessionOperationKind,
  SessionOperationPhase,
  SessionOperationStatus,
} from '../types.js';

type OperationRow = {
  id: string;
  session_id: string;
  namespace_id: string;
  request_id: string;
  kind: string;
  payload_hash: string;
  status: string;
  phase: string | null;
  base_revision: number;
  result_revision: number | null;
  turn_id: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type StoredOperation = SessionOperation & {
  sessionId: string;
  namespaceId: string;
  payloadHash: string;
};

export type AcceptOperationInput = {
  sessionId: string;
  namespaceId: string;
  requestId: string;
  kind: SessionOperationKind;
  payloadHash: string;
  expectedRevision?: number;
  // Extra acceptance check evaluated inside the guard transaction (e.g. adventure completed).
  precondition?: (revision: number) => { code: OperationConflictCode; message: string } | null;
};

export type AcceptOperationResult =
  | { type: 'accepted'; operation: StoredOperation }
  | { type: 'replay'; operation: StoredOperation }
  | { type: 'conflict'; code: OperationConflictCode; message: string; currentRevision: number; activeOperation?: StoredOperation }
  | { type: 'missing' };

const mapRow = (row: OperationRow): StoredOperation => ({
  id: row.id,
  sessionId: row.session_id,
  namespaceId: row.namespace_id,
  requestId: row.request_id,
  kind: row.kind as SessionOperationKind,
  payloadHash: row.payload_hash,
  status: row.status as SessionOperationStatus,
  ...(row.phase && { phase: row.phase as SessionOperationPhase }),
  baseRevision: row.base_revision,
  ...(row.result_revision != null && { resultRevision: row.result_revision }),
  ...(row.turn_id != null && { turnId: row.turn_id }),
  ...(row.error_code && { errorCode: row.error_code }),
  ...(row.error_message && { errorMessage: row.error_message }),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const toPublicOperation = (operation: StoredOperation | null | undefined): SessionOperation | null => {
  if (!operation) {
    return null;
  }
  const { sessionId: _sessionId, namespaceId: _namespaceId, payloadHash: _payloadHash, ...publicOperation } = operation;
  return publicOperation;
};

const getSessionRevision = (sessionId: string): number | undefined => {
  const row = getDb().prepare('SELECT revision FROM sessions WHERE id = ?').get(sessionId) as { revision: number } | undefined;
  return row?.revision;
};

export const operationRepository = {
  get(sessionId: string, operationId: string): StoredOperation | null {
    const row = getDb().prepare('SELECT * FROM session_operations WHERE session_id = ? AND id = ?').get(sessionId, operationId) as OperationRow | undefined;
    return row ? mapRow(row) : null;
  },

  getByRequestId(sessionId: string, requestId: string): StoredOperation | null {
    const row = getDb().prepare('SELECT * FROM session_operations WHERE session_id = ? AND request_id = ?').get(sessionId, requestId) as OperationRow | undefined;
    return row ? mapRow(row) : null;
  },

  getActive(sessionId: string): StoredOperation | null {
    const row = getDb().prepare("SELECT * FROM session_operations WHERE session_id = ? AND status IN ('accepted', 'running') LIMIT 1").get(sessionId) as OperationRow | undefined;
    return row ? mapRow(row) : null;
  },

  getLatest(sessionId: string): StoredOperation | null {
    const row = getDb().prepare('SELECT * FROM session_operations WHERE session_id = ? ORDER BY rowid DESC LIMIT 1').get(sessionId) as OperationRow | undefined;
    return row ? mapRow(row) : null;
  },

  // Accepts a new operation under the per-session guard. Replaying a known request ID
  // returns the stored operation and never starts new work.
  accept(input: AcceptOperationInput): AcceptOperationResult {
    return withTransaction((): AcceptOperationResult => {
      const db = getDb();
      const revision = getSessionRevision(input.sessionId);
      if (revision === undefined) {
        return { type: 'missing' };
      }

      const existingRow = db.prepare('SELECT * FROM session_operations WHERE session_id = ? AND request_id = ?').get(input.sessionId, input.requestId) as OperationRow | undefined;
      if (existingRow) {
        const existing = mapRow(existingRow);
        if (existing.payloadHash !== input.payloadHash || existing.kind !== input.kind || existing.namespaceId !== input.namespaceId) {
          return {
            type: 'conflict',
            code: 'request_id_conflict',
            message: 'This request ID was already used for a different action.',
            currentRevision: revision,
          };
        }
        return { type: 'replay', operation: existing };
      }

      const activeRow = db.prepare("SELECT * FROM session_operations WHERE session_id = ? AND status IN ('accepted', 'running') LIMIT 1").get(input.sessionId) as OperationRow | undefined;
      if (activeRow) {
        return {
          type: 'conflict',
          code: 'operation_in_progress',
          message: 'Another action is still being resolved. Wait for it to finish, then try again.',
          currentRevision: revision,
          activeOperation: mapRow(activeRow),
        };
      }

      if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
        return {
          type: 'conflict',
          code: 'stale_revision',
          message: 'The story moved on since you chose this action. Check the latest scene and try again.',
          currentRevision: revision,
        };
      }

      const preconditionFailure = input.precondition?.(revision);
      if (preconditionFailure) {
        return { type: 'conflict', ...preconditionFailure, currentRevision: revision };
      }

      const id = createId();
      db.prepare(`INSERT INTO session_operations (id, session_id, namespace_id, request_id, kind, payload_hash, status, phase, base_revision)
        VALUES (?, ?, ?, ?, ?, ?, 'accepted', 'resolving', ?)`)
        .run(id, input.sessionId, input.namespaceId, input.requestId, input.kind, input.payloadHash, revision);
      const row = db.prepare('SELECT * FROM session_operations WHERE id = ?').get(id) as OperationRow;
      return { type: 'accepted', operation: mapRow(row) };
    });
  },

  markRunning(operationId: string, phase: SessionOperationPhase = 'resolving'): void {
    getDb().prepare("UPDATE session_operations SET status = 'running', phase = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('accepted', 'running')")
      .run(phase, operationId);
  },

  // Called inside the commit transaction: records the committed turn while the
  // operation continues (e.g. a party wipe that still needs a rescue turn).
  recordProgressSync(operationId: string, turnId: number, revision: number, phase: SessionOperationPhase): void {
    getDb().prepare("UPDATE session_operations SET status = 'running', phase = ?, turn_id = ?, result_revision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('accepted', 'running')")
      .run(phase, turnId, revision, operationId);
  },

  // Called inside the commit transaction so completion and the committed turn are atomic.
  completeSync(operationId: string, turnId: number | null, revision: number): void {
    const result = getDb().prepare("UPDATE session_operations SET status = 'completed', turn_id = COALESCE(?, turn_id), result_revision = ?, error_code = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('accepted', 'running')")
      .run(turnId, revision, operationId);
    if (result.changes !== 1) {
      throw new Error(`Operation ${operationId} is not active; refusing to complete it`);
    }
  },

  // Marks an unfinished operation failed. A completed operation is never downgraded.
  fail(operationId: string, errorCode: string, errorMessage: string): StoredOperation | null {
    const db = getDb();
    db.prepare("UPDATE session_operations SET status = 'failed', error_code = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('accepted', 'running')")
      .run(errorCode, errorMessage, operationId);
    const row = db.prepare('SELECT * FROM session_operations WHERE id = ?').get(operationId) as OperationRow | undefined;
    return row ? mapRow(row) : null;
  },

  // Startup reconciliation. Completion is committed atomically with the turn, so any
  // operation still accepted/running after a restart has no durable result: fail it
  // explicitly instead of silently re-running a possibly paid provider call.
  failInterrupted(): number {
    const result = getDb().prepare("UPDATE session_operations SET status = 'failed', error_code = 'interrupted', error_message = 'The server restarted before this action finished. Please try again.', updated_at = CURRENT_TIMESTAMP WHERE status IN ('accepted', 'running')")
      .run();
    return result.changes;
  },

  deleteForSession(sessionId: string): void {
    getDb().prepare('DELETE FROM session_operations WHERE session_id = ?').run(sessionId);
  },
};
