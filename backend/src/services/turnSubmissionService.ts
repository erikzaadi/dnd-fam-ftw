import { runBackground } from '../middleware/runBackground.js';
import type { StoredOperation } from '../repositories/operationRepository.js';
import { concludeAdventure } from './adventureConclusionService.js';
import { resolvePartyRecovery } from './partyRecoveryService.js';
import { runSessionOperation } from './sessionOperationService.js';
import { executeTurnAction, type TurnActionRequest } from './turnService.js';

// Runs an accepted action operation in the background: the turn, then any ending or
// party-recovery follow-up it triggered, then side effects. Shared by the REST action
// route and MCP confirm_action. Results reach views through SSE and stay readable from
// the snapshot and operation endpoints, independent of the caller's connection.
export const runAcceptedTurnAction = (
  operation: StoredOperation,
  sessionId: string,
  namespaceId: string,
  request: TurnActionRequest,
): void => {
  runBackground(`action session=${sessionId} operation=${operation.id}`, () => runSessionOperation(operation, async () => {
    const result = await executeTurnAction(sessionId, namespaceId, request, { operationId: operation.id });
    if (!result.ok) {
      return {
        error: String(result.body.error ?? 'turn_failed'),
        message: String(result.body.message ?? result.body.error ?? 'Something went wrong. Please try again.'),
      };
    }
    if (result.pendingConclusion) {
      await concludeAdventure({
        sessionId,
        namespaceId,
        operationId: operation.id,
        resolution: result.pendingConclusion,
      });
    }
    if (result.pendingRecovery) {
      await resolvePartyRecovery({
        sessionId,
        namespaceId,
        operationId: operation.id,
        outcome: result.pendingRecovery,
        wipedState: result.body.session,
        revision: result.revision,
      });
    }
    result.queueSideEffects?.();
  }));
};
