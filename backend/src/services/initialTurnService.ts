import { broadcastUpdate } from '../realtime/sessionEvents.js';
import { commitTurn } from '../repositories/turnCommitRepository.js';
import type { SessionState, TurnResult } from '../types.js';
import { AiDmService } from './aiDmService.js';
import { StateService } from './stateService.js';
import { buildAdventureDirective } from './adventureLifecycleService.js';

// Generates and atomically commits a session's opening turn. Shared by the manual
// start route and instant start so both follow the same ownership rules.
export const generateAndCommitInitialTurn = async (params: {
  sessionId: string;
  operationId?: string;
}): Promise<{ turn: TurnResult; state: SessionState } | null> => {
  const { sessionId, operationId } = params;
  const session = await StateService.getSession(sessionId);
  if (!session) {
    return null;
  }

  const directive = buildAdventureDirective(session);
  const initialTurn = await AiDmService.generateTurnResult({
    ...session,
    ...(directive && { adventureDirective: directive }),
    characterId: '',
    actionAttempt: 'Adventure begins!',
    actionResult: { success: true, roll: 20, statUsed: 'none' },
  });

  const state: SessionState = {
    ...session,
    turn: Math.max(session.turn, 2),
    lastChoices: initialTurn.choices,
  };
  const { turnId, revision } = commitTurn({
    sessionId,
    expectedRevision: session.revision ?? 0,
    state,
    turn: initialTurn,
    characterId: null,
    operationId,
    completeOperation: true,
  });
  initialTurn.id = turnId;
  state.revision = revision;
  broadcastUpdate(sessionId, 'turn_complete', { session: state, turnResult: initialTurn, operationId, revision });
  return { turn: initialTurn, state };
};
