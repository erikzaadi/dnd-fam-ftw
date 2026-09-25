import { createNarrationProvider } from '../providers/ai/AiProviderFactory.js';
import type { NarrationStreamCallbacks } from '../providers/ai/narration/NarrationProvider.js';
import type { ActionAttempt, AIInput, ServerTurnResult, SessionState, TurnResult } from '../types.js';
import { toNarrationInput } from './aiDmService.js';
import { repairEncounterNameIfNeeded } from './encounterNameRepairService.js';
import { GameEngine } from './gameEngine.js';
import { buildResolvedTurnFacts, type ResolvedTurnFacts } from './resolvedTurn.js';
import { applyTurnPolicies, type TurnDiagnostics } from './turnDiagnostics.js';
import { checkTurnResultConsistency } from './turnResultConsistencyService.js';
import { stripChoicesTargetingDefeatedEnemies } from './turnRepairs.js';

export type ResolvedFirstTurn = {
  turnResult: ServerTurnResult;
  // The frozen post-turn state: mechanics were applied exactly once, before narration.
  newState: SessionState;
  facts: ResolvedTurnFacts;
};

// Candidate pipeline (plan 4, AI_TURN_STRATEGY=resolved_first):
//   1. mechanics agents propose (combat, inventory, recovery)
//   2. policies + engine apply the proposal once -> frozen state
//   3. ResolvedTurnFacts are derived from the frozen state
//   4. narration and choices are generated from those facts and the post-turn state
// Mechanical truth cannot change in step 4. Returns null when the provider has no
// staged methods; the caller then uses the parallel comparator.
export const generateResolvedFirstTurn = async (params: {
  session: SessionState;
  aiInput: AIInput;
  actionAttempt: ActionAttempt;
  actingCharId: string;
  actionIntent: string | undefined;
  targetCharName: string | undefined;
  streamCallbacks?: NarrationStreamCallbacks;
  diagnostics: TurnDiagnostics;
  // Facts are reported against this state. Item turns apply the item's own effect before
  // the mechanics agents run, so their facts start from the session before the item.
  factsBaseline?: SessionState;
  // Item turns: the engine already applied the item, so the free-action policies (which
  // read the attempt text, e.g. "healing Pip") must not add their own effect on top.
  itemTurn?: boolean;
}): Promise<ResolvedFirstTurn | null> => {
  const { session, aiInput, actionAttempt, actingCharId, diagnostics } = params;
  const provider = createNarrationProvider();
  if (!provider.proposeMechanics || !provider.narrateResolved) {
    return null;
  }
  let stepStart = Date.now();

  const mechanics = await provider.proposeMechanics(toNarrationInput(aiInput));
  stepStart = diagnostics.stage('mechanics', stepStart);

  let proposal: TurnResult = {
    narration: '',
    choices: [],
    imagePrompt: null,
    imageSuggested: false,
    ...mechanics,
  };
  if (!params.itemTurn) {
    proposal = applyTurnPolicies(session, actionAttempt, proposal, params.actionIntent, params.targetCharName, diagnostics);
  }

  // Apply exactly once. A throwaway copy absorbs engine narration hooks (loot claims),
  // and with no narration there is no prose-derived encounter inference: only the
  // combat agent's proposal can start a fight.
  const frozen = GameEngine.applyTurnProposal(session, actionAttempt, { ...proposal });
  await repairEncounterNameIfNeeded(session, frozen, { narration: null, actionAttempt: actionAttempt.actionAttempt });
  const facts = buildResolvedTurnFacts({ previousSession: params.factsBaseline ?? session, resolvedState: frozen, actionAttempt, actingCharId });
  stepStart = diagnostics.stage('resolve', stepStart);

  // Narration and choices see the post-turn party and encounter plus the facts.
  const presentationInput = {
    ...toNarrationInput({
      ...aiInput,
      party: frozen.party,
      encounterState: frozen.encounterState,
      pastEncounters: frozen.pastEncounters,
    }),
    resolvedTurn: facts,
  };
  const presentation = await provider.narrateResolved(presentationInput, params.streamCallbacks);
  diagnostics.stage('presentation', stepStart);

  const turnResult: ServerTurnResult = {
    ...proposal,
    narration: presentation.narration,
    rollNarration: presentation.rollNarration,
    currentTensionLevel: presentation.currentTensionLevel,
    choices: presentation.choices,
    objectiveOutcome: presentation.objectiveOutcome ?? null,
    narratedRiddle: presentation.narratedRiddle ?? null,
    narrationFailed: presentation.narrationFailed ?? false,
    choicesFailed: presentation.choicesFailed ?? false,
    choicesEscalated: presentation.choicesEscalated ?? false,
    agentDiagnostics: [...(mechanics.agentDiagnostics ?? []), ...(presentation.agentDiagnostics ?? [])],
  };
  frozen.lastChoices = turnResult.choices;

  // Safety net only: choices were built from the post-turn encounter, so this should
  // rarely fire. Counted as a repair so the comparison shows how often it still does.
  if (stripChoicesTargetingDefeatedEnemies(frozen, turnResult)) {
    diagnostics.repair('strip_defeated_enemy_choices');
  }
  // Log-only detector, kept as a contradiction metric.
  checkTurnResultConsistency(turnResult, session, actionAttempt);

  return { turnResult, newState: frozen, facts };
};
