import { devLog } from '../lib/devLog.js';
import { runBackground } from '../middleware/runBackground.js';
import { broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import { operationRepository, type StoredOperation } from '../repositories/operationRepository.js';
import { riddleRepository, type StoredRiddle } from '../repositories/riddleRepository.js';
import { commitTurn } from '../repositories/turnCommitRepository.js';
import { turnHistoryRepository } from '../repositories/turnHistoryRepository.js';
import type { SessionState, TurnResult } from '../types.js';
import { extractRiddleAnswer } from './riddleRepairService.js';
import { syncRiddleChoices } from './riddleService.js';
import { acceptSessionOperation, runSessionOperation } from './sessionOperationService.js';
import { StateService } from './stateService.js';

// A riddle recorded without its answer must not block the table. The first answer
// attempt starts recovery: one more attempt to find the answer, and if that fails too,
// a short DM beat that closes the riddle and moves the scene on. Until one of those
// commits, answer attempts keep getting a retryable error (never a stat roll).

export const RIDDLE_ABANDONED_NARRATION = 'The riddle\'s words fade into a soft hum, and the way ahead quietly opens.';

const GUARD_RETRY_MS = 2_000;
const GUARD_ATTEMPTS = 30;
const inFlight = new Set<string>();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isStillUnanswered = (riddleId: string): boolean => {
  const current = riddleRepository.getById(riddleId);
  return !!current && current.status === 'active' && !current.answerKnown;
};

// Commits the closing beat under the session guard. The beat is a narration-only turn:
// nobody acts, the active hero keeps their turn, and nothing else in the state changes.
const commitAbandonment = async (sessionId: string, namespaceId: string, riddleId: string, operation: StoredOperation): Promise<void> => {
  const session = await StateService.getSession(sessionId);
  // Under the guard nothing else commits, so this check holds until the commit below.
  if (!session || !isStillUnanswered(riddleId)) {
    // Nothing to do. Close the operation quietly: nobody asked for it, so no turn_error.
    operationRepository.fail(operation.id, 'riddle_settled', 'The riddle was already settled.');
    return;
  }
  const history = await StateService.getTurnHistory(sessionId);
  // The current suggestions stay valid actions; only their riddle answers go away.
  const choices = syncRiddleChoices(history[history.length - 1]?.choices ?? [], null);
  const beat: TurnResult = {
    narration: RIDDLE_ABANDONED_NARRATION,
    choices,
    imagePrompt: null,
    imageSuggested: false,
    lastAction: null,
    turnType: 'normal',
  };
  const state: SessionState = { ...session, lastChoices: choices };
  const { turnId, revision } = commitTurn({
    sessionId,
    expectedRevision: session.revision ?? 0,
    state,
    turn: beat,
    characterId: null,
    operationId: operation.id,
    additionalWrites: () => {
      riddleRepository.setStatus(riddleId, 'abandoned');
    },
  });
  beat.id = turnId;
  state.revision = revision;
  broadcastUpdate(sessionId, 'turn_complete', { session: state, turnResult: beat, operationId: operation.id, revision });
  broadcastSessionChanged(namespaceId, sessionId, 'updated');
};

// Waits for the session guard (a turn may be resolving), then closes the riddle.
const abandonRiddle = async (sessionId: string, namespaceId: string, riddleId: string): Promise<'abandoned' | 'skipped'> => {
  for (let attempt = 0; attempt < GUARD_ATTEMPTS; attempt++) {
    if (!isStillUnanswered(riddleId)) {
      return 'skipped';
    }
    const acceptance = acceptSessionOperation({ sessionId, namespaceId, kind: 'riddle_recovery', payload: { riddleId } });
    if (acceptance.type === 'accepted') {
      await runSessionOperation(acceptance.operation, () => commitAbandonment(sessionId, namespaceId, riddleId, acceptance.operation));
      return isStillUnanswered(riddleId) ? 'skipped' : 'abandoned';
    }
    if (acceptance.type === 'missing') {
      return 'skipped';
    }
    await sleep(GUARD_RETRY_MS);
  }
  console.warn(`[RiddleRecovery] gave up waiting for the session guard session=${sessionId} riddle=${riddleId}`);
  return 'skipped';
};

export const recoverRiddle = async (sessionId: string, namespaceId: string, riddle: StoredRiddle): Promise<'answered' | 'abandoned' | 'skipped'> => {
  const narration = turnHistoryRepository.getNarration(riddle.sourceTurnId);
  const extracted = narration ? await extractRiddleAnswer(narration, riddle.prompt) : null;
  if (extracted) {
    // No revision bump: answer attempts were all rejected, so no preview depends on this.
    const answered = riddleRepository.setAnswer(riddle.id, extracted);
    devLog.log(`[RiddleRecovery] answer found session=${sessionId} riddle=${riddle.id} stored=${answered}`);
    return answered ? 'answered' : 'skipped';
  }
  const outcome = await abandonRiddle(sessionId, namespaceId, riddle.id);
  console.log(`[RiddleRecovery] answer not found session=${sessionId} riddle=${riddle.id} outcome=${outcome}`);
  return outcome;
};

// Starts recovery at most once per riddle at a time. Safe to call on every rejected attempt.
export const scheduleRiddleRecovery = (sessionId: string, namespaceId: string, riddle: StoredRiddle | null): void => {
  if (!riddle || riddle.answerKnown || riddle.status !== 'active' || inFlight.has(riddle.id)) {
    return;
  }
  inFlight.add(riddle.id);
  runBackground(`riddle-recovery session=${sessionId} riddle=${riddle.id}`, async () => {
    try {
      await recoverRiddle(sessionId, namespaceId, riddle);
    } finally {
      inFlight.delete(riddle.id);
    }
  });
};
