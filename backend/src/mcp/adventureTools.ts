import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { operationRepository } from '../repositories/operationRepository.js';
import type { McpPrincipal } from '../services/accessTokenService.js';
import { continueAdventureWorld, endAdventureHere, setAdventureImagePolicy, wrapUpAdventure } from '../services/adventureLifecycleCommands.js';
import { createAdventure, retryOpening, type CreateAdventureResult } from '../services/adventureCreationService.js';
import type { AcceptanceOutcome } from '../services/sessionOperationService.js';
import type { OperationAcceptedResponse } from '../types.js';
import { admitPaidCall } from './admission.js';
import { toMcpOperation } from './projection.js';
import { createAdventureInput, createAdventureOutput, manageAdventureInput, manageAdventureOutput } from './schemas.js';
import { audit, hasScope, loadOwnedSession, NOT_FOUND_MESSAGE, toolError } from './toolSupport.js';

const RETRY_AFTER_SECONDS = 3;

const isPending = (status: string | undefined) => status === 'accepted' || status === 'running';

export const registerAdventureTools = (server: McpServer, principal: McpPrincipal): void => {
  server.registerTool('create_adventure', {
    title: 'Start a new adventure',
    description: 'Create a new text-only adventure in this realm from the player\'s idea, with an automatic party or heroes the player described, and start its opening scene. '
      + 'Returns the adventure ID and an operation: call get_operation to wait for the opening, then present it. Spends AI budget. Only when the player asks for a new adventure.',
    inputSchema: createAdventureInput,
    outputSchema: createAdventureOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ premise, heroes, partySize, format, images, requestId }) => {
    const startedAt = Date.now();
    if (!hasScope(principal, 'adventures:create')) {
      audit(principal, 'create_adventure', startedAt, 'forbidden');
      return toolError('This token cannot start new adventures. Create a token with "Start new adventures" on the Access tokens page.');
    }
    const result = await createAdventure({
      // Keyed by user, so a replacement token can still resolve an interrupted create.
      ownerKey: `user:${principal.userId}`,
      namespaceId: principal.namespaceId,
      requestId,
      input: { premise, heroes: heroes ?? 'auto', ...(partySize !== undefined && { partySize }), format: format ?? 'one_evening', ...(images === 'on_demand' && { images }) },
      admit: () => admitPaidCall(principal),
    });
    return createResult(result, principal, startedAt);
  });

  server.registerTool('manage_adventure', {
    title: 'Wrap up, end, or continue an adventure',
    description: 'Change where an adventure is heading, only when the player explicitly asks: wrap_up (finale soon, free), end_here (epilogue now), continue_world (new chapter after a completed adventure), '
      + 'retry_opening (only when get_operation reported the opening failed). end_here, continue_world, and retry_opening return an operation to wait for with get_operation and spend AI budget. Nothing is deleted.',
    inputSchema: manageAdventureInput,
    outputSchema: manageAdventureOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ adventureId, action, expectedRevision, requestId, format, images }) => {
    const startedAt = Date.now();
    const tool = `manage_adventure:${action}`;
    if (!hasScope(principal, 'adventures:play')) {
      audit(principal, tool, startedAt, 'forbidden');
      return toolError('This token cannot change adventures.');
    }
    const session = await loadOwnedSession(principal, adventureId);
    if (!session) {
      audit(principal, tool, startedAt, 'not_found');
      return toolError(NOT_FOUND_MESSAGE);
    }
    if (action === 'set_images') {
      if (!images) {
        audit(principal, tool, startedAt, 'missing_images', adventureId);
        return toolError('Say which image setting to use: off, on_demand, or automatic.', 'invalid_request');
      }
      const result = setAdventureImagePolicy(session, images, expectedRevision);
      if (!result.ok) {
        const code = String(result.body.error ?? 'conflict');
        audit(principal, tool, startedAt, code, adventureId);
        return toolError(String(result.body.message ?? 'The image setting cannot change right now.'), code);
      }
      audit(principal, tool, startedAt, 'ok', adventureId);
      return {
        content: [{ type: 'text', text: `Pictures for this adventure are now ${images === 'on_demand' ? 'painted only on request' : images}. This applies to everyone playing it.` }],
        structuredContent: { action, operation: null, replayed: false, revision: result.revision, retryAfterSeconds: null },
      };
    }
    if (action === 'wrap_up') {
      const result = wrapUpAdventure(session, expectedRevision);
      if (!result.ok) {
        const code = String(result.body.error ?? 'conflict');
        audit(principal, tool, startedAt, code, adventureId);
        return toolError(String(result.body.message ?? 'The adventure cannot wrap up right now.'), code);
      }
      audit(principal, tool, startedAt, result.alreadyRequested ? 'replayed' : 'ok', adventureId);
      return {
        content: [{ type: 'text', text: 'The adventure is heading for its finale. Keep playing: the next turns build to the ending.' }],
        structuredContent: { action, operation: null, replayed: result.alreadyRequested, revision: result.revision, retryAfterSeconds: null },
      };
    }
    // A replayed request id costs nothing. end_here is never refused for budget, like
    // on the website: reaching a limit must not block getting an ending.
    const isReplay = !!operationRepository.getByRequestId(adventureId, requestId);
    const needsAdmission = !isReplay && (action === 'retry_opening' || action === 'continue_world');
    if (needsAdmission) {
      const admission = admitPaidCall(principal);
      if (!admission.ok) {
        audit(principal, tool, startedAt, admission.code, adventureId);
        return toolError(admission.message, admission.code);
      }
    }
    if (action === 'retry_opening') {
      const result = await retryOpening(adventureId, principal.namespaceId, requestId);
      if (!result.ok) {
        audit(principal, tool, startedAt, result.error, adventureId);
        return toolError(result.message, result.error);
      }
      audit(principal, tool, startedAt, result.replayed ? 'replayed' : 'accepted', adventureId);
      const operation = toMcpOperation(result.operation);
      return {
        content: [{ type: 'text', text: `Starting the opening again: operation ${operation?.id ?? 'unknown'}. Call get_operation to wait for it.` }],
        structuredContent: { action, operation, replayed: result.replayed, revision: null, retryAfterSeconds: isPending(operation?.status) ? RETRY_AFTER_SECONDS : null },
      };
    }
    const outcome: AcceptanceOutcome = action === 'end_here'
      ? endAdventureHere({ session, namespaceId: principal.namespaceId, requestId, expectedRevision })
      : continueAdventureWorld({ session, namespaceId: principal.namespaceId, adventureFormat: format ?? 'one_evening', requestId, expectedRevision });
    return lifecycleResult(outcome, action, principal, tool, startedAt, adventureId);
  });
};

const createResult = (result: CreateAdventureResult, principal: McpPrincipal, startedAt: number): CallToolResult => {
  if (!result.ok) {
    audit(principal, 'create_adventure', startedAt, result.error);
    return toolError(result.message, result.error);
  }
  const operation = toMcpOperation(result.operation);
  audit(principal, 'create_adventure', startedAt, result.replayed ? 'replayed' : 'accepted', result.sessionId);
  const failed = operation?.status === 'failed';
  return {
    content: [{
      type: 'text',
      text: failed
        ? `Adventure ${result.sessionId} exists but its opening did not finish. Call manage_adventure with action retry_opening (new requestId) if the player wants to try again.`
        : `Adventure ${result.sessionId} is being prepared${operation ? ` (operation ${operation.id})` : ''}. Call get_operation to wait for the opening scene, then present it. Opening scenes can take a minute.`,
    }],
    structuredContent: {
      adventureId: result.sessionId,
      operation,
      replayed: result.replayed,
      retryAfterSeconds: isPending(operation?.status) ? RETRY_AFTER_SECONDS : null,
    },
  };
};

const lifecycleResult = (outcome: AcceptanceOutcome, action: string, principal: McpPrincipal, tool: string, startedAt: number, sessionId: string): CallToolResult => {
  if (outcome.status >= 400) {
    const code = String(outcome.body.error ?? 'conflict');
    audit(principal, tool, startedAt, code, sessionId);
    return toolError(String(outcome.body.message ?? 'This cannot be done right now.'), code);
  }
  const accepted = outcome.body as unknown as OperationAcceptedResponse;
  const operation = toMcpOperation(accepted.operation);
  audit(principal, tool, startedAt, accepted.replayed ? 'replayed' : 'accepted', sessionId);
  return {
    content: [{ type: 'text', text: `${action === 'end_here' ? 'Ending the adventure' : 'Starting a new chapter'}: operation ${operation?.id}. Call get_operation to wait for the story.` }],
    structuredContent: {
      action,
      operation,
      replayed: !!accepted.replayed,
      revision: null,
      retryAfterSeconds: isPending(operation?.status) ? RETRY_AFTER_SECONDS : null,
    },
  };
};
