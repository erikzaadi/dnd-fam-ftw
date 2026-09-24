import { broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import { runBackground } from '../middleware/runBackground.js';
import { buildNarrationFallback } from '../providers/ai/narration/narrationFallback.js';
import { commitTurn } from '../repositories/turnCommitRepository.js';
import type { AIInput, SessionState, TurnResult } from '../types.js';
import { AiDmService, toNarrationInput } from './aiDmService.js';
import { GameEngine } from './gameEngine.js';
import { getTurnEncounterId } from './turnChangeService.js';
import { StorySummaryService } from './storySummaryService.js';
import { devLog } from '../lib/devLog.js';

export type PartyWipeOutcome = 'none' | 'game_over' | 'intervention' | 'sanctuary';

// Deterministic decision made before the wiping turn is committed, so game over is
// persisted atomically with that turn and a rescue is known to be pending.
export const decidePartyWipeOutcome = (state: SessionState): PartyWipeOutcome => {
  if (!GameEngine.isPartyWiped(state)) {
    return 'none';
  }
  const rescueLimit = GameEngine.getRescueLimit(state.difficulty);
  const rescuesUsed = state.interventionState?.rescuesUsed ?? 0;
  if (rescuesUsed >= rescueLimit) {
    return 'game_over';
  }
  return rescuesUsed === 0 ? 'intervention' : 'sanctuary';
};

const generateRecoveryTurn = async (input: AIInput): Promise<TurnResult> => {
  try {
    return await AiDmService.generateTurnResult(input);
  } catch (error) {
    // A rescue must never leave the party wiped with no way forward: fall back to
    // deterministic narration rather than failing the operation.
    console.warn('[PartyRecovery] Narration failed, using fallback:', error);
    return {
      ...buildNarrationFallback(toNarrationInput(input)),
      imagePrompt: null,
      imageSuggested: false,
      narrationFailed: true,
      imageUrl: null,
    };
  }
};

// Runs the rescue (first wipe) or sanctuary (later wipes) turn inside the same
// operation that wiped the party, and completes that operation on commit.
export const resolvePartyRecovery = async (params: {
  sessionId: string;
  namespaceId: string | undefined;
  operationId?: string;
  outcome: 'intervention' | 'sanctuary';
  wipedState: SessionState;
  revision: number;
}): Promise<void> => {
  const { sessionId, namespaceId, operationId, outcome, wipedState, revision } = params;
  const isIntervention = outcome === 'intervention';
  devLog.log(isIntervention ? '[Intervention] Party wiped - triggering dragon rescue' : '[Sanctuary] Party wiped - triggering sanctuary recovery');

  const recoveredState = isIntervention
    ? GameEngine.applyIntervention(wipedState)
    : GameEngine.applySanctuaryRecovery(wipedState);
  const recoveryInput: AIInput = {
    ...recoveredState,
    characterId: '',
    actionAttempt: isIntervention
      ? 'A mysterious force saved the party from doom'
      : 'The party woke up somewhere safe, battered but alive',
    actionResult: { success: true, roll: 0, statUsed: 'none' },
    ...(isIntervention ? { interventionRescue: true } : { sanctuaryRecovery: true }),
  };
  const recoveryTurn = await generateRecoveryTurn(recoveryInput);
  recoveryTurn.turnType = outcome;
  recoveryTurn.imageUrl = isIntervention ? '/images/intervention_dragon.png' : '/images/sanctuary_light.png';

  const postState = GameEngine.applyTurnProposal(recoveredState, recoveryInput, recoveryTurn);
  recoveryTurn.encounterId = getTurnEncounterId(recoveredState, postState);
  const committed = commitTurn({
    sessionId,
    expectedRevision: revision,
    state: postState,
    turn: recoveryTurn,
    characterId: null,
    operationId,
    completeOperation: true,
  });
  recoveryTurn.id = committed.turnId;
  postState.revision = committed.revision;

  broadcastUpdate(sessionId, isIntervention ? 'intervention' : 'sanctuary_recovery', {
    session: postState,
    turnResult: recoveryTurn,
    operationId,
    revision: committed.revision,
  });
  broadcastSessionChanged(namespaceId, sessionId, 'updated');
  runBackground(`${outcome}-summary session=${sessionId}`, () => StorySummaryService.updateAfterIntervention(sessionId, recoveryTurn.narration, postState.turn));
};
