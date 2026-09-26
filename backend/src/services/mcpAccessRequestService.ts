import { isMcpEnabled } from '../config/env.js';
import { withTransaction } from '../persistence/transaction.js';
import { mcpAccessRequestRepository, type McpAccessRequestRow } from '../repositories/mcpAccessRequestRepository.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { isMcpEligible } from './accessTokenService.js';
import { enqueueMcpAccessGrantedNotice, enqueueMcpAccessRequestNotice } from './emailService.js';
import { getNamespaceTier } from './usageLimitService.js';
import type { McpAccessRequestErrorResponse, McpAccessRequestState } from '../types.js';

// "Request assistant access": players without MCP access (any tier, free included) ask
// the operator from the Access tokens page. Approving sets the user's override to on.
// A user whose override is off cannot ask; that is the operator's standing answer.

export const MAX_REQUESTS_PER_WINDOW = 3;
export const REQUEST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type McpAccessRequestResult =
  | { ok: true; requestId: number }
  | { ok: false; error: McpAccessRequestErrorResponse['error'] };

const toState = (row: McpAccessRequestRow | null): McpAccessRequestState | null =>
  row && (row.status === 'pending' || row.status === 'denied')
    ? { status: row.status, createdAt: new Date(row.created_at).toISOString() }
    : null;

// Why the user cannot ask right now, or null when they can.
const refusal = (userId: string, namespaceId: string, now: number): McpAccessRequestErrorResponse['error'] | null => {
  if (!isMcpEnabled() || userRepository.getMcpAccess(userId) === 'off') {
    return 'not_available';
  }
  if (isMcpEligible(userId, namespaceId, now)) {
    return 'not_needed';
  }
  if (mcpAccessRequestRepository.getLatestForUser(userId)?.status === 'pending') {
    return 'already_requested';
  }
  if (mcpAccessRequestRepository.countSince(userId, now - REQUEST_WINDOW_MS) >= MAX_REQUESTS_PER_WINDOW) {
    return 'too_many_requests';
  }
  return null;
};

export const mcpAccessRequestService = {
  getState(userId: string, namespaceId: string, now: number = Date.now()): { canRequestAccess: boolean; accessRequest: McpAccessRequestState | null } {
    return {
      canRequestAccess: refusal(userId, namespaceId, now) === null,
      accessRequest: isMcpEligible(userId, namespaceId, now) ? null : toState(mcpAccessRequestRepository.getLatestForUser(userId)),
    };
  },

  request(input: { userId: string; namespaceId: string; email: string; note: string | null; now?: number }): McpAccessRequestResult {
    const now = input.now ?? Date.now();
    return withTransaction((): McpAccessRequestResult => {
      const refused = refusal(input.userId, input.namespaceId, now);
      if (refused) {
        return { ok: false, error: refused };
      }
      const requestId = mcpAccessRequestRepository.create({ userId: input.userId, namespaceId: input.namespaceId, email: input.email, note: input.note, now });
      if (requestId === null) {
        return { ok: false, error: 'already_requested' };
      }
      enqueueMcpAccessRequestNotice({
        requestId,
        email: input.email,
        namespaceId: input.namespaceId,
        namespaceName: namespaceRepository.getNamespaceById(input.namespaceId)?.name ?? null,
        tier: getNamespaceTier(input.namespaceId, now),
        note: input.note,
        requestedAt: new Date(now),
      });
      return { ok: true, requestId };
    });
  },

  // Grants access (override on) and emails the player. Null when nothing was pending.
  approve(requestId: number, now: number = Date.now()): McpAccessRequestRow | null {
    return withTransaction(() => {
      const request = mcpAccessRequestRepository.get(requestId);
      if (!request || request.status !== 'pending' || !userRepository.getUserById(request.user_id)) {
        return null;
      }
      userRepository.setMcpAccess(request.user_id, 'on');
      mcpAccessRequestRepository.resolve(requestId, 'approved', now);
      enqueueMcpAccessGrantedNotice({ requestId, email: request.email, grantedAt: new Date(now) });
      return request;
    });
  },

  deny(requestId: number, now: number = Date.now()): boolean {
    return mcpAccessRequestRepository.resolve(requestId, 'denied', now);
  },
};
