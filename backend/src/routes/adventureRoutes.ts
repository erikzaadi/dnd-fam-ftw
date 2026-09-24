import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { registerSessionIdParam } from '../middleware/sessionParam.js';
import { runBackground } from '../middleware/runBackground.js';
import { broadcastSessionChanged, broadcastSessionUpdated, broadcastUpdate } from '../realtime/sessionEvents.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { commitTurn } from '../repositories/turnCommitRepository.js';
import { concludeAdventure } from '../services/adventureConclusionService.js';
import { buildAdventureDirective, buildAdventureProgress, createInitialArc, requestWrapUp } from '../services/adventureLifecycleService.js';
import { ensureEveningObjective } from '../services/adventureObjectiveService.js';
import { AiDmService } from '../services/aiDmService.js';
import { applyGuardedSessionMutation } from '../services/sessionMutationService.js';
import { acceptSessionOperation, respondIfKnownRequest, respondToAcceptance, runSessionOperation } from '../services/sessionOperationService.js';
import { StateService } from '../services/stateService.js';
import { ADVENTURE_FORMAT_VALUES, type SessionState } from '../types.js';
import { parseBody } from './routeValidation.js';

const operationBodySchema = z.object({
  requestId: z.string().min(1).max(100).optional(),
  expectedRevision: z.number().int().min(0).optional(),
});

const continueBodySchema = operationBodySchema.extend({
  adventureFormat: z.enum(ADVENTURE_FORMAT_VALUES).default('one_evening'),
});

export const createAdventureRouter = () => {
  const router = Router();
  registerSessionIdParam(router);

  // "Wrap up our adventure": asks for a near-term finale. No AI call and no outcome
  // is invented; the next turns set up and resolve the finale.
  router.post('/session/:id/adventure/wrap-up', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, operationBodySchema);
    if (!body) {
      return;
    }
    const sessionId = req.params.id as string;
    const session = req.session!;
    if (!session.adventure || session.adventure.status !== 'active' || session.gameOver) {
      res.status(409).json({ error: 'adventure_completed', message: 'This adventure is already ending.' });
      return;
    }
    const adventure = requestWrapUp(session.adventure);
    const mutation = applyGuardedSessionMutation(sessionId, body.expectedRevision, () => {
      sessionRepository.writeAdventureSync(sessionId, adventure);
    });
    if (!mutation.ok) {
      res.status(mutation.status).json(mutation.body);
      return;
    }
    broadcastSessionUpdated(sessionId, mutation.revision, { adventure });
    res.json({ revision: mutation.revision, adventure });
  }));

  // "End here with an epilogue": a deliberate early ending from the current state.
  // It does not roll or rotate the actor, and it is allowed at the namespace turn
  // limit so reaching the limit never requires another paid turn to get an ending.
  router.post('/session/:id/adventure/end', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, operationBodySchema);
    if (!body) {
      return;
    }
    const sessionId = req.params.id as string;
    const session = req.session!;
    if (respondIfKnownRequest(res, { sessionId, namespaceId: req.namespaceId, kind: 'end_here', requestId: body.requestId, payload: { kind: 'end_here' } })) {
      return;
    }
    if (session.gameOver || !session.adventure || session.adventure.status === 'completed') {
      res.status(409).json({ error: 'adventure_completed', message: 'This adventure has already ended.' });
      return;
    }
    const operation = respondToAcceptance(res, acceptSessionOperation({
      sessionId,
      namespaceId: req.namespaceId,
      kind: 'end_here',
      requestId: body.requestId,
      expectedRevision: body.expectedRevision,
      payload: { kind: 'end_here' },
    }));
    if (!operation) {
      return;
    }
    runBackground(`end-here session=${sessionId} operation=${operation.id}`, () => runSessionOperation(operation, async () => {
      broadcastUpdate(sessionId, 'adventure_concluding', { operationId: operation.id });
      const ending = await concludeAdventure({ sessionId, namespaceId: req.namespaceId, operationId: operation.id, resolution: 'ended_early' });
      if (!ending) {
        return { error: 'adventure_completed', message: 'This adventure has already ended.' };
      }
    }));
  }));

  // "Continue this world": starts a new chapter with the same heroes, history and
  // ending preserved. Never re-runs the last turn or erases the conclusion.
  router.post('/session/:id/adventure/continue', asyncHandler(async (req, res) => {
    const body = parseBody(req, res, continueBodySchema);
    if (!body) {
      return;
    }
    const sessionId = req.params.id as string;
    const session = req.session!;
    const continuePayload = { kind: 'continue_world', adventureFormat: body.adventureFormat };
    if (respondIfKnownRequest(res, { sessionId, namespaceId: req.namespaceId, kind: 'continue_world', requestId: body.requestId, payload: continuePayload })) {
      return;
    }
    if (session.gameOver || session.adventure?.status !== 'completed') {
      res.status(409).json({ error: 'adventure_active', message: 'Only a completed adventure can continue into a new chapter.' });
      return;
    }
    const operation = respondToAcceptance(res, acceptSessionOperation({
      sessionId,
      namespaceId: req.namespaceId,
      kind: 'continue_world',
      requestId: body.requestId,
      expectedRevision: body.expectedRevision,
      payload: continuePayload,
    }));
    if (!operation) {
      return;
    }
    runBackground(`continue-world session=${sessionId} operation=${operation.id}`, () => runSessionOperation(operation, async () => {
      const current = await StateService.getSession(sessionId);
      if (!current?.adventure || current.adventure.status !== 'completed') {
        return { error: 'adventure_active', message: 'Only a completed adventure can continue into a new chapter.' };
      }
      const adventure = buildAdventureProgress({
        format: body.adventureFormat,
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
      broadcastSessionChanged(req.namespaceId, sessionId, 'updated');
      if (adventure.format === 'one_evening') {
        runBackground(`chapter-objective session=${sessionId}`, () => ensureEveningObjective(sessionId, opening.narration));
      }
    }));
  }));

  return router;
};
