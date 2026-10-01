import { operationRepository, type AcceptOperationResult } from '../repositories/operationRepository.js';
import type { SessionState } from '../types.js';
import { acceptSessionOperation } from './sessionOperationService.js';
import { validateTurnActionRequest, type TurnActionRejection, type TurnActionRequest } from './turnActionInput.js';
import { runAcceptedTurnAction } from './turnSubmissionService.js';

// The turn command: submitting a player's action turn, for the website and assistants.
// The order lives here; each adapter supplies its own pieces and renders the result.
//
//   1. replay     a known request id resolves to its original operation through the
//                 scoped, validated accept (kind, realm, payload hash), before any new
//                 work is prepared, admitted or waited for
//   2. prepare    adapter-specific, synchronous (MCP: the preview and revision checks)
//   3. validate   against the adapter's snapshot of the adventure
//   4. wait       optional (MCP: the undo window); nothing is held open meanwhile
//   5. admit      injected paid-work admission
//   6. accept     atomic: one operation at a time, expected revision checked
//   7. run        only a newly accepted operation starts the runner, exactly once; the
//                 command returns without waiting for narration
//
// Realm scope is the adapter's job before calling (scoped load), and is checked again
// when the run loads state (turnService.executeTurnAction).

export type TurnCommandResult<NotReady, Refusal> =
  | AcceptOperationResult
  | { type: 'not_ready'; reason: NotReady }
  | { type: 'invalid'; rejection: TurnActionRejection }
  | { type: 'refused'; refusal: Refusal }
  | { type: 'cancelled' };

export type TurnCommand<NotReady, Refusal> = {
  adventureId: string;
  realmId: string;
  // Absent: the server generates one; the guard still applies but replay cannot.
  requestId?: string;
  // What makes two submissions the same request. Never includes the expected revision.
  idempotencyPayload: unknown;
  expectedRevision?: number;
  // The adventure as the adapter loaded it, for validation.
  session: SessionState;
  // Runs only when replay found nothing. Returns the request to execute.
  prepareNewWork: () => { ok: true; request: TurnActionRequest } | { ok: false; reason: NotReady };
  beforeAdmit?: () => Promise<'continue' | 'cancelled'>;
  admit: () => { ok: true } | { ok: false; refusal: Refusal };
};

export const submitTurnCommand = async <NotReady, Refusal>(
  command: TurnCommand<NotReady, Refusal>,
): Promise<TurnCommandResult<NotReady, Refusal>> => {
  const { adventureId, realmId, requestId, idempotencyPayload } = command;
  const accept = (expectedRevision?: number) => acceptSessionOperation({
    sessionId: adventureId,
    namespaceId: realmId,
    kind: 'action',
    requestId,
    expectedRevision,
    payload: idempotencyPayload,
  });

  if (requestId && operationRepository.getByRequestId(adventureId, requestId)) {
    return accept();
  }

  const prepared = command.prepareNewWork();
  if (!prepared.ok) {
    return { type: 'not_ready', reason: prepared.reason };
  }
  const rejection = validateTurnActionRequest(command.session, realmId, prepared.request);
  if (rejection) {
    return { type: 'invalid', rejection };
  }
  if (command.beforeAdmit && await command.beforeAdmit() === 'cancelled') {
    return { type: 'cancelled' };
  }
  const admission = command.admit();
  if (!admission.ok) {
    return { type: 'refused', refusal: admission.refusal };
  }
  const result = accept(command.expectedRevision);
  if (result.type === 'accepted') {
    runAcceptedTurnAction(result.operation, adventureId, realmId, prepared.request);
  }
  return result;
};

// The results that come from the atomic accept (accepted, replay, conflict, missing).
export const isAcceptanceResult = <NotReady, Refusal>(result: TurnCommandResult<NotReady, Refusal>): result is AcceptOperationResult =>
  result.type === 'accepted' || result.type === 'replay' || result.type === 'conflict' || result.type === 'missing';
