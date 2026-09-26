import { runBackground } from '../middleware/runBackground.js';
import { broadcastSessionChanged, broadcastSessionUpdated, broadcastUpdate } from '../realtime/sessionEvents.js';
import { operationRepository } from '../repositories/operationRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { commitTurn } from '../repositories/turnCommitRepository.js';
import type { AdventureFormat, AdventureProgress, ImagePolicy, SessionState } from '../types.js';
import { concludeAdventure } from './adventureConclusionService.js';
import { buildAdventureDirective, buildAdventureProgress, createInitialArc, requestWrapUp } from './adventureLifecycleService.js';
import { ensureEveningObjective } from './adventureObjectiveService.js';
import { AiDmService } from './aiDmService.js';
import { applyGuardedSessionMutation } from './sessionMutationService.js';
import { acceptSessionOperation, describeAcceptance, runSessionOperation, type AcceptanceOutcome } from './sessionOperationService.js';
import { StateService } from './stateService.js';

// Adventure lifecycle commands shared by the REST adventure routes and MCP
// manage_adventure: same state checks, operations, and broadcasts for both.

type Rejection = { status: number; body: Record<string, unknown> };

const rejection = (status: number, error: string, message: string): AcceptanceOutcome =>
  ({ status, body: { error, message }, operation: null });

// Known request ids resolve to their original operation before any state check, so a
// retried request gets its first outcome even after the adventure moved on.
const knownRequest = (sessionId: string, namespaceId: string, kind: 'end_here' | 'continue_world', requestId: string | undefined, payload: unknown): AcceptanceOutcome | null => {
  if (!requestId || !operationRepository.getByRequestId(sessionId, requestId)) {
    return null;
  }
  return describeAcceptance(acceptSessionOperation({ sessionId, namespaceId, kind, requestId, payload }));
};

// "Wrap up our adventure": asks for a near-term finale. No AI call and no outcome is
// invented; the next turns set up and resolve the finale. Asking twice is harmless:
// an adventure already wrapping up reports success without another write.
export const wrapUpAdventure = (
  session: SessionState,
  expectedRevision: number | undefined,
): { ok: true; revision: number; adventure: AdventureProgress; alreadyRequested: boolean } | ({ ok: false } & Rejection) => {
  if (!session.adventure || session.adventure.status !== 'active' || session.gameOver) {
    return { ok: false, status: 409, body: { error: 'adventure_completed', message: 'This adventure is already ending.' } };
  }
  if (session.adventure.wrapUpRequested) {
    return { ok: true, revision: session.revision ?? 0, adventure: session.adventure, alreadyRequested: true };
  }
  const adventure = requestWrapUp(session.adventure);
  const mutation = applyGuardedSessionMutation(session.id, expectedRevision, () => {
    sessionRepository.writeAdventureSync(session.id, adventure);
  });
  if (!mutation.ok) {
    return { ok: false, status: mutation.status, body: mutation.body };
  }
  broadcastSessionUpdated(session.id, mutation.revision, { adventure });
  return { ok: true, revision: mutation.revision, adventure, alreadyRequested: false };
};

// Change when pictures are painted for this adventure. Guarded like other settings
// writes (revision, pending operations); affects every viewer of the adventure.
export const setAdventureImagePolicy = (
  session: SessionState,
  policy: ImagePolicy,
  expectedRevision: number | undefined,
): { ok: true; revision: number } | ({ ok: false } & Rejection) => {
  if ((session.imagePolicy ?? (session.savingsMode ? 'off' : 'automatic')) === policy) {
    return { ok: true, revision: session.revision ?? 0 };
  }
  const mutation = applyGuardedSessionMutation(session.id, expectedRevision, () => {
    sessionRepository.setImagePolicy(session.id, policy);
  });
  if (!mutation.ok) {
    return { ok: false, status: mutation.status, body: mutation.body };
  }
  broadcastSessionUpdated(session.id, mutation.revision, { savingsMode: policy !== 'automatic', imagePolicy: policy });
  return { ok: true, revision: mutation.revision };
};

// "End here with an epilogue": a deliberate early ending from the current state. It
// does not roll or rotate the actor, and it is allowed at the namespace turn limit so
// reaching the limit never requires another paid turn to get an ending.
export const endAdventureHere = (params: {
  session: SessionState;
  namespaceId: string;
  requestId?: string;
  expectedRevision?: number;
}): AcceptanceOutcome => {
  const { session, namespaceId, requestId, expectedRevision } = params;
  const sessionId = session.id;
  const payload = { kind: 'end_here' };
  const known = knownRequest(sessionId, namespaceId, 'end_here', requestId, payload);
  if (known) {
    return known;
  }
  if (session.gameOver || !session.adventure || session.adventure.status === 'completed') {
    return rejection(409, 'adventure_completed', 'This adventure has already ended.');
  }
  const outcome = describeAcceptance(acceptSessionOperation({ sessionId, namespaceId, kind: 'end_here', requestId, expectedRevision, payload }));
  const operation = outcome.operation;
  if (operation) {
    runBackground(`end-here session=${sessionId} operation=${operation.id}`, () => runSessionOperation(operation, async () => {
      broadcastUpdate(sessionId, 'adventure_concluding', { operationId: operation.id });
      const ending = await concludeAdventure({ sessionId, namespaceId, operationId: operation.id, resolution: 'ended_early' });
      if (!ending) {
        return { error: 'adventure_completed', message: 'This adventure has already ended.' };
      }
    }));
  }
  return outcome;
};

// "Continue this world": starts a new chapter with the same heroes, history and ending
// preserved. Never re-runs the last turn or erases the conclusion.
export const continueAdventureWorld = (params: {
  session: SessionState;
  namespaceId: string;
  adventureFormat: AdventureFormat;
  requestId?: string;
  expectedRevision?: number;
}): AcceptanceOutcome => {
  const { session, namespaceId, adventureFormat, requestId, expectedRevision } = params;
  const sessionId = session.id;
  const payload = { kind: 'continue_world', adventureFormat };
  const known = knownRequest(sessionId, namespaceId, 'continue_world', requestId, payload);
  if (known) {
    return known;
  }
  if (session.gameOver || session.adventure?.status !== 'completed') {
    return rejection(409, 'adventure_active', 'Only a completed adventure can continue into a new chapter.');
  }
  const outcome = describeAcceptance(acceptSessionOperation({ sessionId, namespaceId, kind: 'continue_world', requestId, expectedRevision, payload }));
  const operation = outcome.operation;
  if (operation) {
    runBackground(`continue-world session=${sessionId} operation=${operation.id}`, () => runSessionOperation(operation, async () => {
      const current = await StateService.getSession(sessionId);
      if (!current?.adventure || current.adventure.status !== 'completed') {
        return { error: 'adventure_active', message: 'Only a completed adventure can continue into a new chapter.' };
      }
      const adventure = buildAdventureProgress({
        format: adventureFormat,
        status: 'active',
        arc: createInitialArc(current.adventure.chapter + 1),
        partySize: current.party.length,
      });
      const chapterState: SessionState = { ...current, adventure, adventurePlan: undefined };
      const directive = buildAdventureDirective(chapterState);
      const opening = await AiDmService.generateTurnResult({
        ...chapterState,
        characterId: '',
        actionAttempt: 'A new chapter of the adventure begins, some time after the last one ended',
        actionResult: { success: true, roll: 20, statUsed: 'none' },
        ...(directive && { adventureDirective: directive }),
      });
      opening.turnType = 'chapter_start';
      const nextState: SessionState = { ...chapterState, lastChoices: opening.choices };
      const { turnId, revision } = commitTurn({
        sessionId,
        expectedRevision: current.revision ?? 0,
        state: nextState,
        turn: opening,
        characterId: null,
        operationId: operation.id,
        additionalWrites: () => {
          sessionRepository.clearAdventureObjectiveSync(sessionId);
          sessionRepository.writeAdventureSync(sessionId, adventure);
        },
      });
      opening.id = turnId;
      nextState.revision = revision;
      broadcastUpdate(sessionId, 'turn_complete', { session: nextState, turnResult: opening, operationId: operation.id, revision });
      broadcastSessionChanged(namespaceId, sessionId, 'updated');
      if (adventure.format === 'one_evening') {
        runBackground(`chapter-objective session=${sessionId}`, () => ensureEveningObjective(sessionId, opening.narration));
      }
    }));
  }
  return outcome;
};
