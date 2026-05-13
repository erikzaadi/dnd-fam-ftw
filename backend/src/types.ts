import type { Choice, ActionAttempt, SceneMomentum, ScenePressure, Session, EncounterState, EncounterSeed } from '@dnd-fam-ftw/shared';

export type * from '@dnd-fam-ftw/shared';

export const GAME_MODE_VALUES = ['cinematic', 'balanced', 'fast', 'zug-ma-geddon'] as const;
export const STAT_VALUES = ['might', 'magic', 'mischief'] as const;
export const DIFFICULTY_VALUES = ['easy', 'normal', 'hard'] as const;
export const TENSION_LEVEL_VALUES = ['low', 'medium', 'high'] as const;
export const IMPACT_VALUES = ['normal', 'strong', 'extreme'] as const;
export const CHOICE_FLAVOR_VALUES = ['standard', 'spotlight', 'combo', 'social', 'item', 'environment'] as const;

export interface SessionState extends Session {
  sceneId: string;
  worldDescription?: string;
  dmPrep?: string;
  dmPrepImageBrief?: string;
  encounterState?: EncounterState;
  dmPrepEncounters?: EncounterSeed[];
  npcs: string[];
  quests: string[];
  lastChoices: Choice[];
  tone: string;
  recentHistory: string[];
  difficulty: string;
  storySummary: string;
}

export interface AIInput extends SessionState, ActionAttempt {
  characterId: string;
  scenePressure?: ScenePressure;
  sceneMomentum?: SceneMomentum;
  interventionRescue?: boolean;
  sanctuaryRecovery?: boolean;
  actionIntent?: string;
}
