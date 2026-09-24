import type { Choice, ActionAttempt, SceneMomentum, ScenePressure, Session, EncounterState, EncounterSeed } from '@dnd-fam-ftw/shared';

export type * from '@dnd-fam-ftw/shared';

export const GAME_MODE_VALUES = ['cinematic', 'balanced', 'fast', 'zug-ma-geddon'] as const;
export const STAT_VALUES = ['might', 'magic', 'mischief'] as const;
export const DIFFICULTY_VALUES = ['easy', 'normal', 'hard'] as const;
export const TENSION_LEVEL_VALUES = ['low', 'medium', 'high'] as const;
export const IMPACT_VALUES = ['normal', 'strong', 'extreme'] as const;
export const CHOICE_FLAVOR_VALUES = ['standard', 'spotlight', 'combo', 'social', 'item', 'environment'] as const;
export const ADVENTURE_FORMAT_VALUES = ['one_evening', 'long_lived'] as const;
export const OBJECTIVE_OUTCOME_VALUES = ['none', 'advanced', 'resolved_success', 'resolved_setback'] as const;

// Private per-turn guidance from adventureLifecycleService. Reaches prompts only,
// never clients or player-visible text.
export interface AdventureDirective {
  format: import('@dnd-fam-ftw/shared').AdventureFormat;
  phase: import('@dnd-fam-ftw/shared').AdventurePhase;
  objective?: string;
  // Private chapter payoff from DM Prep: steer toward it, never reveal it verbatim.
  chapterPayoff?: string;
  instruction: string;
  // Heroes who have not yet had a meaningful turn this chapter.
  heroesAwaitingSpotlight?: string[];
  // True when this turn's action is an attempt at the decisive finale moment:
  // narration reports objectiveOutcome.
  decisiveMoment: boolean;
}

export interface SessionState extends Session {
  sceneId: string;
  worldDescription?: string;
  dmPrep?: string;
  compiledDmPrep?: string;
  dmPrepImageBrief?: string;
  encounterState?: EncounterState;
  pastEncounters?: EncounterState[];
  dmPrepEncounters?: EncounterSeed[];
  npcs: string[];
  quests: string[];
  lastChoices: Choice[];
  tone: string;
  recentHistory: string[];
  difficulty: string;
  storySummary: string;
  // Private chapter payoff (adventure_plan column). Stripped by toPublicSession.
  adventurePlan?: string;
}

export interface AIInput extends SessionState, ActionAttempt {
  characterId: string;
  scenePressure?: ScenePressure;
  sceneMomentum?: SceneMomentum;
  interventionRescue?: boolean;
  sanctuaryRecovery?: boolean;
  actionIntent?: string;
  recentChoiceLabels?: string[];
  adventureDirective?: AdventureDirective;
}
