import { StateService } from './stateService.js';
import { operationRepository, toPublicOperation } from '../repositories/operationRepository.js';
import { toPublicSession, toPublicTurn } from './sessionProjection.js';
import type { SessionSnapshot } from '../types.js';

// Reads session, history and operation state until the revision is stable, so a
// reconnecting client never mixes a newer session with older history (or vice versa).
// Shared by the REST snapshot route and MCP get_adventure.
export const readCoherentSnapshot = async (sessionId: string): Promise<SessionSnapshot | null> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = StateService.getRevision(sessionId);
    if (before === undefined) {
      return null;
    }
    const [session, history] = await Promise.all([
      StateService.getSession(sessionId),
      StateService.getTurnHistory(sessionId),
    ]);
    const activeOperation = toPublicOperation(operationRepository.getActive(sessionId));
    const latestOperation = toPublicOperation(operationRepository.getLatest(sessionId));
    if (!session) {
      return null;
    }
    if (StateService.getRevision(sessionId) === before) {
      return { revision: before, session: toPublicSession(session), history: history.map(toPublicTurn), activeOperation, latestOperation };
    }
  }
  return null;
};
