import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { autoConfirmRepository } from '../repositories/autoConfirmRepository.js';
import type { McpPrincipal } from '../services/accessTokenService.js';
import { readCoherentSnapshot } from '../services/sessionSnapshotService.js';
import { setUsageSessionId } from '../lib/usageContext.js';
import { audit, hasScope, NOT_FOUND_MESSAGE, ownsAdventure, toolError } from './toolSupport.js';
import { registerPlayTools } from './playTools.js';
import { registerAdventureTools } from './adventureTools.js';
import { registerImageTools } from './imageTools.js';
import { renderAdventureListText, renderAdventureText, toAdventureListItem, toAdventureView } from './projection.js';
import { getAdventureInput, getAdventureOutput, listAdventuresInput, listAdventuresOutput } from './schemas.js';

const DEFAULT_LIST_LIMIT = 10;

const encodeCursor = (offset: number): string => Buffer.from(`o:${offset}`).toString('base64url');

const decodeCursor = (cursor: string | undefined): number | null => {
  if (!cursor) {
    return 0;
  }
  const match = /^o:(\d{1,6})$/.exec(Buffer.from(cursor, 'base64url').toString());
  return match ? Number(match[1]) : null;
};

export const registerTools = (server: McpServer, principal: McpPrincipal, disconnected: AbortSignal): void => {
  server.registerTool('list_adventures', {
    title: 'List adventures',
    description: 'List adventures in this realm, most recently played first. Free: no AI cost. Use it to find an adventure ID to resume.',
    inputSchema: listAdventuresInput,
    outputSchema: listAdventuresOutput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ cursor, limit }) => {
    const startedAt = Date.now();
    if (!hasScope(principal, 'adventures:read')) {
      audit(principal, 'list_adventures', startedAt, 'forbidden');
      return toolError('This token cannot read adventures.');
    }
    const offset = decodeCursor(cursor);
    if (offset === null) {
      audit(principal, 'list_adventures', startedAt, 'bad_cursor');
      return toolError('Unknown cursor. Call list_adventures without a cursor to start over.');
    }
    const pageSize = limit ?? DEFAULT_LIST_LIMIT;
    // One extra row tells whether another page exists.
    const rows = sessionRepository.listAdventureSummaries(principal.namespaceId, pageSize + 1, offset);
    const adventures = rows.slice(0, pageSize).map(toAdventureListItem);
    const nextCursor = rows.length > pageSize ? encodeCursor(offset + pageSize) : null;
    audit(principal, 'list_adventures', startedAt, 'ok');
    return {
      content: [{ type: 'text', text: renderAdventureListText(adventures, nextCursor) }],
      structuredContent: { adventures, nextCursor },
    };
  });

  server.registerTool('get_adventure', {
    title: 'Read an adventure',
    description: 'Read the current state of one adventure: party, encounter, lifecycle, any operation in progress, and the latest story turns. Free: no AI cost, never advances the story. Call it after reconnecting or losing context instead of relying on chat memory.',
    inputSchema: getAdventureInput,
    outputSchema: getAdventureOutput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ adventureId, historyLimit, beforeTurnId }) => {
    const startedAt = Date.now();
    if (!hasScope(principal, 'adventures:read')) {
      audit(principal, 'get_adventure', startedAt, 'forbidden');
      return toolError('This token cannot read adventures.');
    }
    if (!ownsAdventure(principal, adventureId)) {
      audit(principal, 'get_adventure', startedAt, 'not_found');
      return toolError(NOT_FOUND_MESSAGE);
    }
    setUsageSessionId(adventureId);
    const snapshot = await readCoherentSnapshot(adventureId);
    if (!snapshot) {
      audit(principal, 'get_adventure', startedAt, 'unavailable', adventureId);
      return toolError('The adventure is changing right now. Try again in a few seconds.');
    }
    const view = toAdventureView(snapshot, { historyLimit, beforeTurnId, autoConfirmSafe: autoConfirmRepository.isEnabled(principal.userId, adventureId) });
    audit(principal, 'get_adventure', startedAt, 'ok', adventureId);
    return {
      content: [{ type: 'text', text: renderAdventureText(view) }],
      structuredContent: view,
    };
  });

  registerPlayTools(server, principal, disconnected);
  registerAdventureTools(server, principal);
  registerImageTools(server, principal);
};
