import type {
  AdventureArcState,
  AdventureDirective,
  AdventureFormat,
  AdventurePhase,
  AdventureProgress,
  AdventureResolution,
  AdventureStatus,
  EncounterState,
  ObjectiveOutcome,
  SessionState,
} from '../types.js';

// Deterministic adventure lifecycle. Persisted arc state is the only authority for
// phase and completion; story summaries and narration text are never parsed to
// decide where the adventure is.
//
// Pacing values are initial tuning parameters for a proposed 30-60 minute evening,
// evaluated by family play sessions before being treated as settled. P = party size.
//   development starts after max(3, P) committed player actions (everyone had a turn)
//   finale starts after      max(8, 2P)
//   finale should resolve by max(12, 3P)
// Thresholds are pacing signals: they steer the story, they never award victory.
export const PACING = {
  developmentMin: 3,
  finaleMin: 8,
  finalePerHero: 2,
  resolveMin: 12,
  resolvePerHero: 3,
  // Rolled finale attempts past the resolve target before offering keep-going / end-here.
  overtimeAttempts: 2,
} as const;

export const createInitialArc = (chapter: number = 1): AdventureArcState => ({
  chapter,
  phase: 'opening',
  playerActionCount: 0,
  budgetStartCount: 0,
  participatingHeroIds: [],
  wrapUpRequested: false,
  decisiveAttempts: 0,
});

export const parseArc = (raw: string | null | undefined): AdventureArcState => {
  if (!raw) {
    return createInitialArc();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AdventureArcState>;
    return { ...createInitialArc(), ...parsed };
  } catch {
    return createInitialArc();
  }
};

// Persisted JSON excludes derived fields.
export const serializeArc = (progress: AdventureArcState): string => {
  const arc: AdventureArcState = {
    chapter: progress.chapter,
    phase: progress.phase,
    playerActionCount: progress.playerActionCount,
    budgetStartCount: progress.budgetStartCount,
    participatingHeroIds: progress.participatingHeroIds,
    wrapUpRequested: progress.wrapUpRequested,
    decisiveAttempts: progress.decisiveAttempts,
    ...(progress.finaleStartedAtCount !== undefined && { finaleStartedAtCount: progress.finaleStartedAtCount }),
    ...(progress.continueOffered && { continueOffered: true }),
    ...(progress.resolution && { resolution: progress.resolution }),
    ...(progress.conclusionTurnId !== undefined && { conclusionTurnId: progress.conclusionTurnId }),
  };
  return JSON.stringify(arc);
};

export type PacingTargets = {
  developmentAt: number;
  finaleAt: number;
  resolveBy: number;
};

export const computePacingTargets = (partySize: number, budgetStartCount: number): PacingTargets => {
  const heroes = Math.max(1, partySize);
  return {
    developmentAt: budgetStartCount + Math.max(PACING.developmentMin, heroes),
    finaleAt: budgetStartCount + Math.max(PACING.finaleMin, PACING.finalePerHero * heroes),
    resolveBy: budgetStartCount + Math.max(PACING.resolveMin, PACING.resolvePerHero * heroes),
  };
};

export const buildAdventureProgress = (params: {
  format: AdventureFormat;
  status: AdventureStatus;
  arc: AdventureArcState;
  objective?: string | null;
  partySize: number;
}): AdventureProgress => {
  const { format, status, arc, objective, partySize } = params;
  const targets = format === 'one_evening' ? computePacingTargets(partySize, arc.budgetStartCount) : null;
  return {
    ...arc,
    format,
    status,
    ...(objective && { objective }),
    ...(targets && { finaleTargetAt: targets.finaleAt, resolveByTarget: targets.resolveBy }),
  };
};

const activeHeroNamesAwaitingSpotlight = (session: SessionState, arc: AdventureArcState): string[] =>
  session.party
    .filter(c => c.status === 'active' && !arc.participatingHeroIds.includes(c.id))
    .map(c => c.name);

const objectivePhrase = (objective: string | undefined): string =>
  objective ? `the chapter objective ("${objective}")` : 'one clear, achievable goal the opening established';

// True when the finale has already been set up, so this action is an attempt at it.
const isDecisiveTurn = (progress: AdventureProgress): boolean =>
  progress.phase === 'finale' &&
  progress.finaleStartedAtCount !== undefined &&
  progress.playerActionCount > progress.finaleStartedAtCount;

// Private prompt guidance for the next turn. Long-lived sessions get no ending
// pressure unless the players explicitly asked to wrap up the chapter.
export const buildAdventureDirective = (session: SessionState): AdventureDirective | undefined => {
  const progress = session.adventure;
  if (!progress || progress.status !== 'active') {
    return undefined;
  }
  if (progress.format === 'long_lived' && !progress.wrapUpRequested) {
    return undefined;
  }

  const objective = progress.objective;
  const awaiting = activeHeroNamesAwaitingSpotlight(session, progress);
  const base = {
    format: progress.format,
    phase: progress.phase,
    ...(objective && { objective }),
    ...(session.adventurePlan && { chapterPayoff: session.adventurePlan }),
    ...(awaiting.length > 0 && { heroesAwaitingSpotlight: awaiting }),
  };
  const spotlight = awaiting.length > 0
    ? ` Give ${awaiting.join(', ')} (already with the party, not newcomers) a concrete reason to matter soon.`
    : '';

  if (progress.phase === 'finale') {
    if (!isDecisiveTurn(progress)) {
      return {
        ...base,
        decisiveMoment: false,
        instruction: `FINALE SETUP: bring the party face to face with the decisive moment for ${objectivePhrase(objective)} now. Make the final challenge concrete and visible. Pay off established clues, NPCs and items; introduce no new unrelated threads.${spotlight}`,
      };
    }
    const overtime = progress.continueOffered
      ? ' The finale has run long: keep the decisive moment clearly in front of the party.'
      : '';
    return {
      ...base,
      decisiveMoment: true,
      instruction: `FINALE: this action is an attempt at the decisive moment for ${objectivePhrase(objective)}. A success that directly addresses it can resolve the chapter; a failure has real consequences and keeps the moment open (fail forward). Never grant a victory the action did not earn. If the action ignores the objective, keep the decisive moment in view.${overtime}`,
    };
  }

  if (progress.phase === 'opening') {
    return {
      ...base,
      decisiveMoment: false,
      instruction: objective
        ? `ONE-EVENING OPENING: make the chapter objective ("${objective}") visible and concrete in the scene so the party knows what tonight is about.`
        : 'ONE-EVENING OPENING: establish one clear, concrete problem the party can solve tonight, grounded in the premise.',
    };
  }

  return {
    ...base,
    decisiveMoment: false,
    instruction: `BUILD TOWARD THE FINALE: every scene should move the party closer to ${objectivePhrase(objective)}. Keep threads few; reuse established NPCs, places and clues.${spotlight}`,
  };
};

export type ArcTurnFacts = {
  countsAsPlayerAction: boolean;
  actingCharacterId?: string;
  partySize: number;
  // null when the action had no roll (item use, riddle answer, stat "none").
  rollSucceeded: boolean | null;
  objectiveOutcome?: ObjectiveOutcome | null;
  encounterResolvedThisTurn: boolean;
  partyWiped: boolean;
};

export type ArcTurnResult = {
  progress: AdventureProgress;
  // Set when this turn resolved the chapter: the ending should follow in the same operation.
  resolution?: AdventureResolution;
};

// Validates narration's objective proposal against committed facts. A resolution is
// accepted only when the mechanics support it; otherwise it is ignored.
export const validateObjectiveOutcome = (facts: ArcTurnFacts, priorFailedAttempts: number): AdventureResolution | null => {
  if (facts.partyWiped) {
    return null;
  }
  const proposal = facts.objectiveOutcome ?? null;
  if (proposal === 'resolved_success') {
    return facts.rollSucceeded !== false || facts.encounterResolvedThisTurn ? 'success' : null;
  }
  if (proposal === 'resolved_setback') {
    // A setback ending needs a failed decisive attempt, after at least one earlier
    // failed attempt so the party always gets a fail-forward chance.
    return facts.rollSucceeded === false && priorFailedAttempts >= 1 ? 'setback' : null;
  }
  // Narration unavailable (fallback) or silent: a finale encounter defeated/fled/
  // surrendered this turn is itself committed proof the decisive moment was won.
  if (proposal === null && facts.encounterResolvedThisTurn) {
    return 'success';
  }
  return null;
};

const nextPhase = (progress: AdventureProgress, targets: PacingTargets | null): AdventurePhase => {
  if (progress.phase === 'finale' || progress.phase === 'epilogue') {
    return progress.phase;
  }
  if (progress.wrapUpRequested) {
    return 'finale';
  }
  if (!targets) {
    return progress.phase === 'opening' ? 'development' : progress.phase;
  }
  if (progress.playerActionCount >= targets.finaleAt) {
    return 'finale';
  }
  if (progress.playerActionCount >= targets.developmentAt) {
    return 'development';
  }
  return progress.phase;
};

// Applies one committed turn to the chapter progress. Pure: the caller persists the
// result atomically with the turn.
export const advanceArcAfterTurn = (progress: AdventureProgress, facts: ArcTurnFacts): ArcTurnResult => {
  if (progress.status !== 'active' || !facts.countsAsPlayerAction) {
    return { progress };
  }

  const next: AdventureProgress = {
    ...progress,
    playerActionCount: progress.playerActionCount + 1,
    participatingHeroIds: facts.actingCharacterId && !progress.participatingHeroIds.includes(facts.actingCharacterId)
      ? [...progress.participatingHeroIds, facts.actingCharacterId]
      : progress.participatingHeroIds,
  };

  const endingPressure = progress.format === 'one_evening' || progress.wrapUpRequested;
  const targets = progress.format === 'one_evening' ? computePacingTargets(facts.partySize, progress.budgetStartCount) : null;

  // Resolution is only possible once the finale was set up on an earlier turn.
  if (endingPressure && progress.phase === 'finale' && progress.finaleStartedAtCount !== undefined && progress.playerActionCount > progress.finaleStartedAtCount) {
    const priorFailedAttempts = progress.decisiveAttempts;
    const resolution = validateObjectiveOutcome(facts, priorFailedAttempts);
    if (resolution) {
      return {
        progress: { ...next, status: 'concluding', phase: 'epilogue', resolution, continueOffered: false },
        resolution,
      };
    }
    if (facts.rollSucceeded === false) {
      next.decisiveAttempts = progress.decisiveAttempts + 1;
    }
    const resolveBy = targets?.resolveBy ?? (progress.finaleStartedAtCount + PACING.resolveMin - PACING.finaleMin);
    if (next.playerActionCount >= resolveBy + PACING.overtimeAttempts) {
      // Do not loop forever under a finite contract, and never force an outcome:
      // the views now offer "keep playing" or "end here with an epilogue".
      next.continueOffered = true;
    }
    return { progress: next };
  }

  const phase = endingPressure ? nextPhase(next, targets) : (next.phase === 'opening' ? 'development' : next.phase);
  if (phase === 'finale' && next.phase !== 'finale') {
    next.finaleStartedAtCount = next.playerActionCount;
  }
  next.phase = phase;
  return { progress: next };
};

// Players asked for a near-term finale. Does not invent an outcome.
export const requestWrapUp = (progress: AdventureProgress): AdventureProgress => {
  if (progress.status !== 'active' || progress.wrapUpRequested) {
    return progress;
  }
  const alreadyInFinale = progress.phase === 'finale';
  return {
    ...progress,
    wrapUpRequested: true,
    phase: 'finale',
    finaleStartedAtCount: alreadyInFinale && progress.finaleStartedAtCount !== undefined
      ? progress.finaleStartedAtCount
      : progress.playerActionCount,
  };
};

// Checking "Long-lived" removes ending pressure. Unchecking it starts a fresh
// remaining-evening budget from the current point instead of applying the old total.
export const changeAdventureFormat = (progress: AdventureProgress, format: AdventureFormat): AdventureProgress => {
  if (progress.format === format) {
    return progress;
  }
  if (format === 'long_lived') {
    return {
      ...progress,
      format,
      continueOffered: false,
      ...(!progress.wrapUpRequested && progress.phase === 'finale' && { phase: 'development' as const, finaleStartedAtCount: undefined }),
    };
  }
  return {
    ...progress,
    format,
    budgetStartCount: progress.playerActionCount,
    decisiveAttempts: 0,
    continueOffered: false,
    ...(progress.phase === 'finale' && !progress.wrapUpRequested && { phase: 'development' as const, finaleStartedAtCount: undefined }),
  };
};

export const encounterResolvedThisTurn = (previous: EncounterState | undefined, next: EncounterState | undefined): boolean =>
  previous?.status === 'active' &&
  !!next &&
  next.id === previous.id &&
  ['defeated', 'fled', 'surrendered', 'resolved'].includes(next.status);

// Party wipes are handled by rescue/game-over rules; an ending never follows the same
// operation as a wipe.
export const isAdventureCompleted = (session: Pick<SessionState, 'adventure'>): boolean =>
  session.adventure?.status === 'completed';
