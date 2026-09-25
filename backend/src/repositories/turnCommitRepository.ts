import { getDb } from '../persistence/database.js';
import { withTransaction } from '../persistence/transaction.js';
import type { SessionOperationPhase, SessionState, TurnResult } from '../types.js';
import { operationRepository } from './operationRepository.js';
import { sessionRepository } from './sessionRepository.js';
import { turnHistoryRepository } from './turnHistoryRepository.js';

export class StaleRevisionError extends Error {
  constructor(public readonly expectedRevision: number, public readonly currentRevision: number | undefined) {
    super(`Session revision changed: expected ${expectedRevision}, found ${currentRevision ?? 'missing session'}`);
    this.name = 'StaleRevisionError';
  }
}

export type CommitTurnInput = {
  sessionId: string;
  // Revision the turn was computed from. The commit fails if anything else committed since.
  expectedRevision: number;
  state: SessionState;
  turn: TurnResult;
  characterId: string | null;
  operationId?: string;
  // false keeps the operation running (e.g. a party wipe still needs a rescue turn).
  completeOperation?: boolean;
  continuingPhase?: SessionOperationPhase;
  // Extra writes that must land in the same transaction (e.g. adventure lifecycle state).
  additionalWrites?: (revision: number, turnId: number) => void;
};

export type CommitTurnResult = {
  turnId: number;
  revision: number;
};

// Atomically writes gameplay state, the history row with its choices, the new
// revision and the operation result. Either all of it lands or none of it does.
export const commitTurn = (input: CommitTurnInput): CommitTurnResult => withTransaction(() => {
  const currentRevision = sessionRepository.getRevision(input.sessionId);
  if (currentRevision !== input.expectedRevision) {
    throw new StaleRevisionError(input.expectedRevision, currentRevision);
  }

  sessionRepository.writeGameplayStateSync(input.sessionId, input.state);
  const turnId = turnHistoryRepository.insertTurnResultSync(input.sessionId, input.turn, input.characterId, input.operationId);
  const revision = input.expectedRevision + 1;
  getDb().prepare('UPDATE sessions SET revision = ? WHERE id = ?').run(revision, input.sessionId);
  // The turn's choices (possibly none) belong to this revision and the hero who acts next.
  turnHistoryRepository.setIdeasMetaSync(turnId, revision, input.state.activeCharacterId, !!input.turn.choicesFailed);
  input.turn.ideasRevision = revision;
  input.turn.ideasCharacterId = input.state.activeCharacterId || undefined;
  input.turn.ideasDegraded = !!input.turn.choicesFailed || undefined;
  input.additionalWrites?.(revision, turnId);

  if (input.operationId) {
    if (input.completeOperation === false) {
      operationRepository.recordProgressSync(input.operationId, turnId, revision, input.continuingPhase ?? 'resolving');
    } else {
      operationRepository.completeSync(input.operationId, turnId, revision);
    }
  }

  return { turnId, revision };
});
