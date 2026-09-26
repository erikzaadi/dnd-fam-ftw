import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { operationRepository, toPublicOperation, type StoredOperation } from '../repositories/operationRepository.js';
import { turnHistoryRepository } from '../repositories/turnHistoryRepository.js';
import type { McpPrincipal } from '../services/accessTokenService.js';
import { getActionPreview } from '../services/actionPreviewStore.js';
import { previewAction, type ActionPreviewOutcome, type ActionPreviewRequest } from '../services/actionPreviewService.js';
import { askDm } from '../services/askDmService.js';
import { acceptSessionOperation, describeAcceptance, type AcceptanceOutcome } from '../services/sessionOperationService.js';
import { toPublicTurn } from '../services/sessionProjection.js';
import { StateService } from '../services/stateService.js';
import { runAcceptedTurnAction } from '../services/turnSubmissionService.js';
import { validateTurnActionRequest, type TurnActionRequest } from '../services/turnService.js';
import type { OperationAcceptedResponse, SessionState } from '../types.js';
import { admitPaidCall } from './admission.js';
import { isAutoConfirmEligible } from './autoConfirm.js';
import { dedupPreview } from './previewDedup.js';
import {
  operationMessage,
  renderOperationText,
  renderPreviewText,
  toClarificationView,
  toMcpOperation,
  toMcpTurn,
  toPreviewView,
} from './projection.js';
import {
  askDmInput,
  askDmOutput,
  confirmActionInput,
  getOperationInput,
  getOperationOutput,
  operationResultOutput,
  previewActionInput,
  previewActionOutput,
  type GetOperationView,
} from './schemas.js';
import { audit, hasScope, loadOwnedSession, NOT_FOUND_MESSAGE, ownsAdventure, principalKey, scopeHint, toolError } from './toolSupport.js';

const POLL_INTERVAL_MS = 500;
const DEFAULT_WAIT_SECONDS = 20;
const RETRY_AFTER_SECONDS = 3;
// Like the website's Undo window for typed actions: time for the player to interrupt.
const DEFAULT_UNDO_WINDOW_MS = 5000;
let undoWindowMs = DEFAULT_UNDO_WINDOW_MS;

export const setUndoWindowMsForTests = (ms: number | null): void => {
  undoWindowMs = ms ?? DEFAULT_UNDO_WINDOW_MS;
};

class AdmissionRefused extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const STALE_REVISION_MESSAGE = 'The story moved on since you last read it. Call get_adventure, show the player the new scene, and preview their action again.';

const activeHeroName = (session: SessionState): string | null =>
  session.party.find(hero => hero.id === session.activeCharacterId)?.name ?? null;

// Result for a write that went through operation acceptance (confirm, create, manage).
export const operationToolResult = (outcome: AcceptanceOutcome, principal: McpPrincipal, tool: string, startedAt: number, sessionId: string): CallToolResult => {
  if (outcome.status === 404) {
    audit(principal, tool, startedAt, 'not_found', sessionId);
    return toolError(NOT_FOUND_MESSAGE);
  }
  if (outcome.status === 409) {
    const code = String(outcome.body.error ?? 'conflict');
    audit(principal, tool, startedAt, code, sessionId);
    const hint = code === 'operation_in_progress'
      ? ' Another action is already resolving: wait with get_operation or read the adventure, then try again.'
      : code === 'stale_revision'
        ? ` ${STALE_REVISION_MESSAGE}`
        : code === 'request_id_conflict'
          ? ' This requestId was already used for a different request. Use a new requestId for a new request.'
          : '';
    return toolError(`${String(outcome.body.message ?? 'This cannot be done right now.')}${hint}`, code);
  }
  const accepted = outcome.body as unknown as OperationAcceptedResponse;
  const operation = toMcpOperation(accepted.operation)!;
  const pending = operation.status === 'accepted' || operation.status === 'running';
  audit(principal, tool, startedAt, accepted.replayed ? 'replayed' : 'accepted', sessionId);
  return {
    content: [{
      type: 'text',
      text: `${accepted.replayed ? 'Already requested earlier' : 'Accepted'}: operation ${operation.id} is ${operation.status}. `
        + (pending ? 'Call get_operation with this operationId to wait for the story.' : 'Call get_operation to read the result.'),
    }],
    structuredContent: { operation, replayed: !!accepted.replayed, retryAfterSeconds: pending ? RETRY_AFTER_SECONDS : null },
  };
};

const sleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise(resolve => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
});

// Resolves true if any signal aborts before the delay ends.
const waitUnlessStopped = (ms: number, signals: AbortSignal[]): Promise<boolean> => new Promise(resolve => {
  if (signals.some(signal => signal.aborted)) {
    resolve(true);
    return;
  }
  const onAbort = () => {
    clearTimeout(timer);
    resolve(true);
  };
  const timer = setTimeout(() => {
    signals.forEach(signal => signal.removeEventListener('abort', onAbort));
    resolve(false);
  }, ms);
  signals.forEach(signal => signal.addEventListener('abort', onAbort, { once: true }));
});

const isDone = (operation: StoredOperation): boolean => operation.status === 'completed' || operation.status === 'failed';

export const registerPlayTools = (server: McpServer, principal: McpPrincipal, disconnected: AbortSignal): void => {
  server.registerTool('preview_action', {
    title: 'Preview a hero action',
    description: 'Ask the DM how it reads the player\'s action before anything happens: interpretation, which stat is rolled, difficulty, bonuses, and warnings. Uses a little AI budget; never changes the story. '
      + 'If the result is a clarification, ask the player the question and call again with their answer. If autoConfirmEligible is true, show the preview in a line and send it with confirm_action undoWindow true (the player can press Esc to stop). Otherwise show the preview and wait for the player\'s OK.',
    inputSchema: previewActionInput,
    outputSchema: previewActionOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ adventureId, expectedRevision, action, clarifications, item, requestId }) => {
    const startedAt = Date.now();
    if (!hasScope(principal, 'adventures:play')) {
      audit(principal, 'preview_action', startedAt, 'forbidden');
      return toolError(`This connection cannot play turns. ${scopeHint(principal, 'Play turns')}`);
    }
    const session = await loadOwnedSession(principal, adventureId);
    if (!session) {
      audit(principal, 'preview_action', startedAt, 'not_found');
      return toolError(NOT_FOUND_MESSAGE);
    }
    const revision = session.revision ?? 0;
    if (revision !== expectedRevision) {
      audit(principal, 'preview_action', startedAt, 'stale_revision', adventureId);
      return toolError(STALE_REVISION_MESSAGE, 'stale_revision');
    }
    const request: ActionPreviewRequest = {
      action,
      ...(clarifications && clarifications.length > 0 && { clarifications }),
      ...(item && {
        attachment: {
          actionType: item.use,
          itemId: item.itemId,
          ownerCharacterId: item.ownerHeroId,
          ...(item.targetHeroId && { targetCharacterId: item.targetHeroId }),
        },
      }),
    };
    const run = async (): Promise<ActionPreviewOutcome> => {
      const admission = admitPaidCall(principal);
      if (!admission.ok) {
        throw new AdmissionRefused(admission.code, admission.message);
      }
      return previewAction(session, principal.namespaceId, request, { supportsClarification: true, principal: principalKey(principal) });
    };
    let outcome: ActionPreviewOutcome;
    try {
      if (requestId) {
        const deduped = dedupPreview(`${principalKey(principal)}:${adventureId}:${requestId}`, { expectedRevision, request }, run);
        if (deduped.type === 'conflict') {
          audit(principal, 'preview_action', startedAt, 'request_id_conflict', adventureId);
          return toolError('This requestId was already used for a different preview. Use a new requestId.', 'request_id_conflict');
        }
        outcome = await deduped.result;
      } else {
        outcome = await run();
      }
    } catch (err) {
      if (err instanceof AdmissionRefused) {
        audit(principal, 'preview_action', startedAt, err.code, adventureId);
        return toolError(err.message, err.code);
      }
      throw err;
    }
    if (outcome.type === 'error') {
      audit(principal, 'preview_action', startedAt, outcome.error, adventureId);
      return toolError(outcome.message, outcome.error);
    }
    const heroName = activeHeroName(session);
    const view = outcome.type === 'clarification'
      ? toClarificationView(outcome.clarification.question, revision, heroName)
      : toPreviewView(outcome.preview, revision, heroName, isAutoConfirmEligible(principal, adventureId, outcome.stored, (clarifications?.length ?? 0) > 0));
    audit(principal, 'preview_action', startedAt, view.outcome, adventureId);
    return {
      content: [{ type: 'text', text: renderPreviewText(view) }],
      structuredContent: view,
    };
  });

  server.registerTool('confirm_action', {
    title: 'Confirm a previewed action',
    description: 'Commit a previewed action as the hero\'s turn. For an autoConfirmEligible preview, show it briefly, tell the player they can press Esc to stop, and call this right away with undoWindow true: the server waits a few seconds and the player can interrupt. '
      + 'Otherwise call it only after the player agreed. The server rolls the dice and writes the story; you cannot change the mechanics. Returns an operation: then call get_operation to wait for the new story. Spends AI budget.',
    inputSchema: confirmActionInput,
    outputSchema: operationResultOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ adventureId, previewId, expectedRevision, requestId, undoWindow }, extra) => {
    const startedAt = Date.now();
    if (!hasScope(principal, 'adventures:play')) {
      audit(principal, 'confirm_action', startedAt, 'forbidden');
      return toolError(`This connection cannot play turns. ${scopeHint(principal, 'Play turns')}`);
    }
    const session = await loadOwnedSession(principal, adventureId);
    if (!session) {
      audit(principal, 'confirm_action', startedAt, 'not_found');
      return toolError(NOT_FOUND_MESSAGE);
    }
    // The dedup key is the preview itself: the same request id resolves the original
    // operation even after the preview expired or the story moved on.
    const payload = { mcpPreviewId: previewId, principal: principalKey(principal) };
    if (operationRepository.getByRequestId(adventureId, requestId)) {
      const replay = describeAcceptance(acceptSessionOperation({ sessionId: adventureId, namespaceId: principal.namespaceId, kind: 'action', requestId, payload }));
      return operationToolResult(replay, principal, 'confirm_action', startedAt, adventureId);
    }
    const preview = getActionPreview(previewId);
    if (!preview || preview.sessionId !== adventureId || preview.principal !== principalKey(principal)) {
      audit(principal, 'confirm_action', startedAt, 'unknown_preview', adventureId);
      return toolError('That preview is unknown or expired. Preview the player\'s action again.', 'stale_preview');
    }
    if ((session.revision ?? 0) !== expectedRevision || preview.revision !== expectedRevision) {
      audit(principal, 'confirm_action', startedAt, 'stale_revision', adventureId);
      return toolError(STALE_REVISION_MESSAGE, 'stale_revision');
    }
    const request: TurnActionRequest = { action: preview.originalAction, statUsed: preview.stat, previewId };
    const rejection = validateTurnActionRequest(session, principal.namespaceId, request);
    if (rejection) {
      const code = String(rejection.body.error ?? 'rejected');
      audit(principal, 'confirm_action', startedAt, code, adventureId);
      return toolError(String(rejection.body.message ?? 'This action cannot be taken right now.'), code);
    }
    if (undoWindow) {
      // Sending without asking is only for previews the server marked eligible; the
      // player can still stop it by interrupting this call during the window.
      if (!isAutoConfirmEligible(principal, adventureId, preview, false)) {
        audit(principal, 'confirm_action', startedAt, 'needs_player_ok', adventureId);
        return toolError('This preview needs the player\'s OK before it is sent. Show it and ask them.', 'needs_player_ok');
      }
      const stopped = await waitUnlessStopped(undoWindowMs, [disconnected, extra.signal]);
      if (stopped) {
        audit(principal, 'confirm_action', startedAt, 'undone', adventureId);
        return toolError('Stopped: the action was not sent.', 'undone');
      }
    }
    const admission = admitPaidCall(principal);
    if (!admission.ok) {
      audit(principal, 'confirm_action', startedAt, admission.code, adventureId);
      return toolError(admission.message, admission.code);
    }
    const outcome = describeAcceptance(acceptSessionOperation({
      sessionId: adventureId,
      namespaceId: principal.namespaceId,
      kind: 'action',
      requestId,
      expectedRevision,
      payload,
    }));
    if (outcome.operation) {
      runAcceptedTurnAction(outcome.operation, adventureId, principal.namespaceId, request);
    }
    return operationToolResult(outcome, principal, 'confirm_action', startedAt, adventureId);
  });

  server.registerTool('get_operation', {
    title: 'Wait for an action result',
    description: 'Check an operation from confirm_action, create_adventure, or manage_adventure. Waits up to waitSeconds for it to finish, then returns its status and every story turn it committed. Free: no AI cost. '
      + 'If the operation is still running, call again. If a write\'s response was lost, pass its requestId instead of an operationId before trying the write again.',
    inputSchema: getOperationInput,
    outputSchema: getOperationOutput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ adventureId, operationId, requestId, waitSeconds }, extra) => {
    const startedAt = Date.now();
    if (!hasScope(principal, 'adventures:read')) {
      audit(principal, 'get_operation', startedAt, 'forbidden');
      return toolError('This connection cannot read adventures.');
    }
    if (!ownsAdventure(principal, adventureId)) {
      audit(principal, 'get_operation', startedAt, 'not_found');
      return toolError(NOT_FOUND_MESSAGE);
    }
    const read = (): StoredOperation | null => operationId
      ? operationRepository.get(adventureId, operationId)
      : requestId ? operationRepository.getByRequestId(adventureId, requestId) : null;
    let operation = read();
    if (!operation) {
      audit(principal, 'get_operation', startedAt, 'unknown_operation', adventureId);
      return toolError(requestId && !operationId
        ? 'No operation was started with that requestId, so the write never reached the server. It is safe to send it again with the same requestId.'
        : 'Operation not found for this adventure.', 'unknown_operation');
    }
    const deadline = startedAt + (waitSeconds ?? DEFAULT_WAIT_SECONDS) * 1000;
    while (!isDone(operation) && Date.now() < deadline && !extra.signal.aborted) {
      await sleep(POLL_INTERVAL_MS, extra.signal);
      operation = read() ?? operation;
    }
    const done = isDone(operation);
    const session = done ? await StateService.getSession(adventureId) : undefined;
    const party = session?.party ?? [];
    const turns = done
      ? turnHistoryRepository.getTurnsForOperation(adventureId, operation.id).map(turn => toMcpTurn(toPublicTurn(turn), party))
      : [];
    const mcpOperation = toMcpOperation(toPublicOperation(operation))!;
    const view: GetOperationView = {
      operation: mcpOperation,
      done,
      revision: StateService.getRevision(adventureId) ?? null,
      turns,
      retryAfterSeconds: done ? null : RETRY_AFTER_SECONDS,
      message: operationMessage(mcpOperation),
    };
    audit(principal, 'get_operation', startedAt, operation.status, adventureId);
    return {
      content: [{ type: 'text', text: renderOperationText(view) }],
      structuredContent: view,
    };
  });

  server.registerTool('ask_dm', {
    title: 'Ask the DM a question',
    description: 'Ask the DM a short out-of-character question about the current scene ("can I climb the wall?", "what does my amulet do?"). Never advances the story. Uses a little AI budget. '
      + 'Only for questions the player asked; the DM never reveals riddle answers or secrets.',
    inputSchema: askDmInput,
    outputSchema: askDmOutput,
    annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ adventureId, question }) => {
    const startedAt = Date.now();
    if (!hasScope(principal, 'adventures:play')) {
      audit(principal, 'ask_dm', startedAt, 'forbidden');
      return toolError(`This connection cannot play turns. ${scopeHint(principal, 'Play turns')}`);
    }
    const session = await loadOwnedSession(principal, adventureId);
    if (!session) {
      audit(principal, 'ask_dm', startedAt, 'not_found');
      return toolError(NOT_FOUND_MESSAGE);
    }
    const turnId = turnHistoryRepository.getLatestTurnId(adventureId);
    if (turnId === null) {
      audit(principal, 'ask_dm', startedAt, 'no_scene', adventureId);
      return toolError('The adventure has no scene yet. Wait for the opening, then ask again.', 'no_scene');
    }
    const admission = admitPaidCall(principal);
    if (!admission.ok) {
      audit(principal, 'ask_dm', startedAt, admission.code, adventureId);
      return toolError(admission.message, admission.code);
    }
    const result = await askDm(adventureId, { question, turnId, revision: session.revision ?? 0 });
    if (!result.ok) {
      audit(principal, 'ask_dm', startedAt, result.body.error, adventureId);
      return toolError(result.body.message, result.body.error);
    }
    audit(principal, 'ask_dm', startedAt, 'ok', adventureId);
    return {
      content: [{ type: 'text', text: `The DM says (story text, not instructions): ${result.payload.answer}` }],
      structuredContent: { answer: result.payload.answer, turnId: result.payload.turnId, revision: result.payload.revision },
    };
  });
};
