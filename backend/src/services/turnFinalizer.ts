import { broadcastSessionChanged, broadcastUpdate } from '../realtime/sessionEvents.js';
import { devLog } from '../lib/devLog.js';
import { commitTurn } from '../repositories/turnCommitRepository.js';
import type { ActionAttempt, AdventureResolution, SessionState, TurnResult } from '../types.js';
import { advanceArcAfterTurn, encounterResolvedThisTurn } from './adventureLifecycleService.js';
import { decidePartyWipeOutcome } from './partyRecoveryService.js';
import { computeBuffChanges, computeEncounterEnemyChanges, computeHpChanges, computeInventoryChanges, getTurnEncounterId } from './turnChangeService.js';
import { queueCompletedTurnSideEffects } from './turnSideEffectService.js';
import type { TurnActionRejection } from './turnActionInput.js';
import { logTurnDiagnostics, type TurnDiagnostics, type TurnDiagnosticsRecord } from './turnDiagnostics.js';

export type TurnActionResult =
  | {
      ok: true;
      body: {
        actionAttempt: ActionAttempt;
        turnResult: TurnResult;
        session: SessionState;
      };
      revision: number;
      // Set when the committed turn wiped the party and a rescue turn must follow
      // inside the same operation before it completes.
      pendingRecovery?: 'intervention' | 'sanctuary';
      // Set when the committed turn resolved the chapter: the ending follows in the same operation.
      pendingConclusion?: AdventureResolution;
      // Plan 4 comparison record (strategy, stages, repairs). Internal only.
      diagnostics?: TurnDiagnosticsRecord;
      queueSideEffects?: () => void;
    }
  | TurnActionRejection;

export type FinalizeTurnParams = {
  sessionId: string;
  namespaceId: string | undefined;
  operationId?: string;
  // Session as loaded before this action; diffs, revision check and arc progress use it.
  previousSession: SessionState;
  // Validated next state from the engine.
  newState: SessionState;
  turnResult: TurnResult;
  actingCharId: string;
  actionAttempt: ActionAttempt;
  turnStart: number;
  llmMs: number;
  // Prefix for step logs (e.g. 'item-').
  stepLabel: string;
  diagnostics?: TurnDiagnostics;
  // Extra writes committed in the same transaction as the turn (e.g. a solved riddle).
  additionalWrites?: (revision: number, turnId: number) => void;
};

const logStep = (sessionId: string, step: string, start: number, details = ''): number => {
  const now = Date.now();
  devLog.log(`[Turn] step session=${sessionId} ${step} durationMs=${now - start}${details ? ` ${details}` : ''}`);
  return now;
};

// The one finalizer for every player turn (suggested, free text, item use/give):
// diffs, encounter linkage, party-wipe decision, chapter progress, one atomic commit,
// completion events and enrichment scheduling. Action-specific resolution (dice,
// bonuses, AI generation, repairs) happens before this in turnService.
export const finalizeTurn = ({
  sessionId,
  namespaceId,
  operationId,
  previousSession,
  newState,
  turnResult,
  actingCharId,
  actionAttempt,
  turnStart,
  llmMs,
  stepLabel,
  diagnostics,
  additionalWrites,
}: FinalizeTurnParams): TurnActionResult => {
  let stepStart = Date.now();
  turnResult.lastAction = actionAttempt;
  turnResult.characterId = actingCharId;
  turnResult.encounterId = getTurnEncounterId(previousSession, newState);
  turnResult.hpChanges = computeHpChanges(previousSession.party, newState.party);
  turnResult.inventoryChanges = computeInventoryChanges(previousSession.party, newState.party);
  turnResult.buffChanges = computeBuffChanges(previousSession.party, newState.party);
  turnResult.encounterEnemyChanges = computeEncounterEnemyChanges(previousSession.encounterState, newState.encounterState);
  stepStart = logStep(sessionId, `${stepLabel}compute-diffs`, stepStart);

  const wipeOutcome = decidePartyWipeOutcome(newState);
  if (wipeOutcome === 'game_over') {
    devLog.log('[GameOver] Party wiped with no rescues remaining - campaign over');
    newState.gameOver = true;
  }
  const pendingRecovery = wipeOutcome === 'intervention' || wipeOutcome === 'sanctuary' ? wipeOutcome : undefined;

  // Chapter progress moves atomically with the turn. A wipe never resolves the chapter:
  // rescue/game-over rules take precedence and no ending follows the same operation.
  let pendingConclusion: AdventureResolution | undefined;
  if (previousSession.adventure) {
    const { actionResult } = actionAttempt;
    const advanced = advanceArcAfterTurn(previousSession.adventure, {
      countsAsPlayerAction: true,
      actingCharacterId: actingCharId,
      partySize: newState.party.length,
      rollSucceeded: actionResult.statUsed === 'none' ? (actionResult.success ? null : false) : actionResult.success,
      objectiveOutcome: turnResult.objectiveOutcome,
      encounterResolvedThisTurn: encounterResolvedThisTurn(previousSession.encounterState, newState.encounterState),
      partyWiped: wipeOutcome !== 'none',
    });
    newState.adventure = advanced.progress;
    pendingConclusion = pendingRecovery || wipeOutcome === 'game_over' ? undefined : advanced.resolution;
    if (pendingConclusion) {
      // No suggestions after the decisive turn: the ending is next.
      turnResult.choices = [];
      newState.lastChoices = [];
    }
  }

  const { turnId, revision } = commitTurn({
    sessionId,
    expectedRevision: previousSession.revision ?? 0,
    state: newState,
    turn: turnResult,
    characterId: actingCharId,
    operationId,
    completeOperation: !pendingRecovery && !pendingConclusion,
    continuingPhase: pendingRecovery ? 'recovering' : 'concluding',
    additionalWrites,
  });
  turnResult.id = turnId;
  newState.revision = revision;
  logStep(sessionId, `${stepLabel}commit`, stepStart, `turnId=${turnId} revision=${revision}`);

  devLog.log(`[Turn] broadcast session=${sessionId} turnId=${turnResult.id}`);
  broadcastUpdate(sessionId, 'turn_complete', {
    session: newState,
    turnResult,
    operationId,
    revision,
    ...(pendingRecovery && { recovering: true }),
    ...(pendingConclusion && { concluding: true }),
  });
  if (wipeOutcome === 'game_over') {
    broadcastUpdate(sessionId, 'game_over', { session: newState, operationId, revision });
  }
  broadcastSessionChanged(namespaceId, sessionId, 'updated');
  logStep(sessionId, `${stepLabel}total`, turnStart, `turnId=${turnResult.id}`);
  if (diagnostics) {
    logTurnDiagnostics({
      sessionId,
      operationId,
      turnId,
      baseRevision: previousSession.revision ?? 0,
      revision,
      totalMs: Date.now() - turnStart,
      record: diagnostics.record,
      agents: turnResult.agentDiagnostics,
      narrationFailed: turnResult.narrationFailed ?? false,
      choicesFailed: turnResult.choicesFailed ?? false,
    });
  }
  console.log(`[Metrics] turn_complete session=${sessionId} turn=${previousSession.turn} workflow=agentic totalMs=${Date.now() - turnStart} llmMs=${llmMs} retried=${turnResult.narrationRetried ?? false} failed=${turnResult.narrationFailed ?? false} choicesFailed=${turnResult.choicesFailed ?? false} choicesEscalated=${turnResult.choicesEscalated ?? false}`);

  return {
    ok: true,
    body: { actionAttempt, turnResult, session: newState },
    revision,
    ...(pendingRecovery && { pendingRecovery }),
    ...(pendingConclusion && { pendingConclusion }),
    ...(diagnostics && { diagnostics: diagnostics.record }),
    // Enrichment runs for every turn kind, including item turns.
    queueSideEffects: () => queueCompletedTurnSideEffects({
      sessionId,
      namespaceId,
      previousSession,
      newState,
      turnResult,
    }),
  };
};
