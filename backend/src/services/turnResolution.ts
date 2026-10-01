import type { TurnStrategy } from '../config/env.js';
import type { NarrationProvider, NarrationStreamCallbacks } from '../providers/ai/narration/NarrationProvider.js';
import type { ActionAttempt, AIInput, ServerTurnResult, SessionState, TurnResult } from '../types.js';
import { AiDmService, toNarrationInput } from './aiDmService.js';
import type { EncounterNameRepairer } from './encounterNameRepairService.js';
import type { TurnDecision } from './freeActionPolicyService.js';
import { GameEngine } from './gameEngine.js';
import { buildResolvedTurnFacts, type ResolvedTurnFacts } from './resolvedTurn.js';
import { applyTurnPolicies, type TurnDiagnostics } from './turnDiagnostics.js';
import { alignTurnWithResolvedEncounter, stripChoicesTargetingDefeatedEnemies } from './turnRepairs.js';
import { checkTurnResultConsistency } from './turnResultConsistencyService.js';

// Turn resolution: everything between "the action attempt is known" and "here is the
// new state and the turn result". The caller prepares the context (aiInput, decision,
// item effect) and afterwards handles riddles, persistence and broadcasting.
//
// Step order per path. The differences are deliberate:
//
//   step                          parallel rolled   parallel item   resolved_first
//   free-action policies          yes               no (a)          yes, not on items (a)
//   consistency diagnostic (b)    before apply      before apply    last
//   engine apply                  after generation  after gen.      once, before narration (c)
//   encounter name repair         with narration    with narration  without narration
//   align narration to encounter  yes               yes             no (c)
//   strip defeated-enemy choices  yes               yes             yes, safety net
//
//   (a) Item turns: the engine already applied the item. A policy reading the attempt
//       text ("healing Pip") would add its effect a second time.
//   (b) Log-only. It reports contradictions and never rejects a proposal.
//   (c) resolved_first freezes mechanics before narration, so narration is generated
//       from the settled outcome instead of being repaired to match it.

export type TurnAiDeps = {
  narration: NarrationProvider;
  nameRepair: EncounterNameRepairer;
};

export type TurnResolutionParams = {
  kind: 'rolled' | 'item';
  // The state the turn starts from. Item turns: after the item's own effect.
  session: SessionState;
  // resolved_first facts are measured against this state. Item turns pass the session
  // before the item, so the story tells both the item and what followed.
  factsBaseline?: SessionState;
  attempt: ActionAttempt;
  actingCharId: string;
  // Prepared by the caller: resolution never builds prompt input itself.
  aiInput: AIInput;
  // Read by the policies; never read on item turns.
  decision: TurnDecision;
  deps: TurnAiDeps;
  stream?: NarrationStreamCallbacks;
  diagnostics: TurnDiagnostics;
};

export type TurnResolution = {
  turnResult: ServerTurnResult;
  newState: SessionState;
  // resolved_first only, measured before the caller's finalizer runs. Parallel has none.
  facts?: ResolvedTurnFacts;
  strategyUsed: TurnStrategy;
};

export const resolveTurn = async (params: TurnResolutionParams): Promise<TurnResolution> => {
  const { diagnostics } = params;
  const generationStart = Date.now();
  if (diagnostics.record.strategy === 'resolved_first') {
    const resolved = await resolveFirst(params);
    if (resolved) {
      return { ...resolved, strategyUsed: 'resolved_first' };
    }
    // The provider has no staged methods: use the parallel comparator.
    diagnostics.record.strategy = 'parallel';
  }
  return { ...(await resolveParallel(params, generationStart)), strategyUsed: 'parallel' };
};

// Parallel: one generation call returns narration and mechanics together; the engine
// applies them and the narration is repaired to match the outcome.
const resolveParallel = async (
  params: TurnResolutionParams,
  generationStart: number,
): Promise<{ turnResult: ServerTurnResult; newState: SessionState }> => {
  const { kind, session, attempt, aiInput, decision, deps, stream, diagnostics } = params;
  // Goes through AiDmService for output normalization, the narration fallback and the
  // 429 rethrow; never call the provider directly here.
  let turnResult = await AiDmService.generateTurnResult(aiInput, stream, deps.narration);
  diagnostics.stage('generation', generationStart);
  if (kind === 'rolled') {
    turnResult = applyTurnPolicies(session, attempt, turnResult, decision, diagnostics);
  }
  checkTurnResultConsistency(turnResult, session, attempt);
  const newState = GameEngine.applyTurnProposal(session, attempt, turnResult);
  await deps.nameRepair(session, newState, {
    narration: turnResult.narration,
    actionAttempt: attempt.actionAttempt,
  });
  const narrationBeforeAlign = turnResult.narration;
  alignTurnWithResolvedEncounter(session, newState, turnResult);
  if (turnResult.narration !== narrationBeforeAlign) {
    diagnostics.repair('align_resolved_encounter_narration');
  }
  if (stripChoicesTargetingDefeatedEnemies(newState, turnResult)) {
    diagnostics.repair('strip_defeated_enemy_choices');
  }
  return { turnResult, newState };
};

// resolved_first:
//   1. mechanics agents propose (combat, inventory, recovery)
//   2. policies + engine apply the proposal once -> frozen state
//   3. ResolvedTurnFacts are derived from the frozen state
//   4. narration and choices are generated from those facts and the post-turn state
// Mechanical truth cannot change in step 4. Returns null when the provider has no
// staged methods.
const resolveFirst = async (
  params: TurnResolutionParams,
): Promise<{ turnResult: ServerTurnResult; newState: SessionState; facts: ResolvedTurnFacts } | null> => {
  const { kind, session, attempt, actingCharId, aiInput, decision, deps, stream, diagnostics } = params;
  const provider = deps.narration;
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
  if (kind === 'rolled') {
    proposal = applyTurnPolicies(session, attempt, proposal, decision, diagnostics);
  }

  // Apply exactly once. A throwaway copy absorbs engine narration hooks (loot claims),
  // and with no narration there is no prose-derived encounter inference: only the
  // combat agent's proposal can start a fight.
  const frozen = GameEngine.applyTurnProposal(session, attempt, { ...proposal });
  await deps.nameRepair(session, frozen, { narration: null, actionAttempt: attempt.actionAttempt });
  const facts = buildResolvedTurnFacts({ previousSession: params.factsBaseline ?? session, resolvedState: frozen, actionAttempt: attempt, actingCharId });
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
  const presentation = await provider.narrateResolved(presentationInput, stream);
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
  checkTurnResultConsistency(turnResult, session, attempt);

  return { turnResult, newState: frozen, facts };
};
