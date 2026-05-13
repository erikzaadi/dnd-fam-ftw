import type { CharacterBuff, ChoiceFlavor, Difficulty, EncounterSeed, EncounterState, GameMode, Impact, SceneMomentum, ScenePressure, Stat, TensionLevel } from '../../../types.js';
import type { EncounterStartProposal, EncounterUpdateProposal } from './narrationSchemas.js';

export type NarrationChoice = {
  label: string;
  difficulty: Difficulty;
  stat: Stat;
  difficultyValue: number;
  narration?: string;
  riddleAnswer?: string;
  riddleCorrect?: boolean;
  flavor?: ChoiceFlavor;
  helperCharacterName?: string;
  itemOwnerName?: string;
  itemName?: string;
  environmentFeature?: string;
};

export type NarrationInput = {
  scene: string;
  storySummary?: string;
  scenePressure?: ScenePressure;
  sceneMomentum?: SceneMomentum;
  actingCharacterName?: string;
  nextCharacterName?: string;
  party: Array<{
    name: string;
    class: string;
    species: string;
    hp: number;
    maxHp: number;
    stats: { might: number; magic: number; mischief: number };
    status: 'active' | 'downed';
    quirk?: string;
    gender?: string;
    history?: string;
    buffs?: CharacterBuff[];
  }>;
  inventory: Array<{
    ownerName: string;
    name: string;
    description: string;
    statBonuses: { might?: number; magic?: number; mischief?: number };
    healValue?: number;
    consumable?: boolean;
    transferable?: boolean;
    tags?: string[];
    effect?: string;
    charges?: number;
    condition?: string;
    boundToCharacterName?: string;
  }>;
  actionAttempt: string;
  actionResult: {
    success: boolean;
    roll?: number;
    statUsed?: Stat;
    statBonus?: number;
    itemBonus?: number;
    helperBonus?: number;
    helperCharacterName?: string;
    choiceItemBonus?: number;
    choiceItemName?: string;
    choiceItemOwnerName?: string;
    characterBonus?: number;
    characterBonusLabel?: string;
    buffBonus?: number;
    buffBonusLabel?: string;
    total?: number;
    margin?: number;
    difficultyTarget?: number;
    impact?: Impact;
    difficulty?: string;
    summary: string;
  };
  recentHistory: string[];
  previousChoiceLabels?: string[];
  previousChoiceItemNames?: string[];
  previousChoiceFlavors?: ChoiceFlavor[];
  selectedChoiceFlavor?: ChoiceFlavor;
  selectedEnvironmentFeature?: string;
  tone: string;
  gameMode?: GameMode;
  dmPrep?: string;
  dmPrepEncounters?: EncounterSeed[];
  isFirstTurn?: boolean;
  interventionRescue?: boolean;
  sanctuaryRecovery?: boolean;
  actionIntent?: string;
  encounterState?: EncounterState;
  encounterJustResolved?: boolean;
  encounterLootHint?: string;
};

export type NarrationOutput = {
  narration: string;
  choices: NarrationChoice[];
  rollNarration?: string;
  imagePrompt: string | null;
  imageSuggested: boolean;
  currentTensionLevel: TensionLevel;
  suggestedInventoryAdd: {
    name: string;
    description: string;
    targetCharacterName?: string;
    statBonuses: { might?: number; magic?: number; mischief?: number };
    healValue?: number;
    consumable?: boolean;
    transferable?: boolean;
    tags?: string[];
    effect?: string;
    charges?: number;
    condition?: string;
    boundToCharacterName?: string;
  } | null;
  suggestedInventoryRemove: { characterName: string; itemName: string } | null;
  suggestedInventoryUpdate: {
    characterName: string;
    itemName: string;
    name?: string;
    description?: string;
    statBonuses?: { might?: number; magic?: number; mischief?: number };
    healValue?: number;
    consumable?: boolean;
    transferable?: boolean;
    tags?: string[];
    effect?: string;
    charges?: number;
    condition?: string;
    boundToCharacterName?: string;
  } | null;
  suggestedRevive: { characterName: string; hp: number } | null;
  suggestedHeal: Array<{ characterName: string; hp: number }> | null;
  suggestedBuffAdd: Array<{ characterName: string } & Omit<CharacterBuff, 'id'>> | null;
  suggestedBuffRemove: { characterName: string; buffName: string } | null;
  suggestedDamage: number | null;
  suggestedEncounterStart: EncounterStartProposal | null;
  suggestedEncounterUpdate: EncounterUpdateProposal | null | undefined;
  narrationRetried?: boolean;
  narrationFailed?: boolean;
  narrationValidationError?: string;
  narrationRetryValidationError?: string;
};

export interface NarrationProvider {
  generateTurn(input: NarrationInput): Promise<NarrationOutput>;
}
