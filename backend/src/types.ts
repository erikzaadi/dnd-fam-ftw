export type CharacterStatus = 'active' | 'downed';

export const GAME_MODE_VALUES = ['cinematic', 'balanced', 'fast', 'zug-ma-geddon'] as const;
export type GameMode = typeof GAME_MODE_VALUES[number];

export const STAT_VALUES = ['might', 'magic', 'mischief'] as const;
export type Stat = typeof STAT_VALUES[number];

export const DIFFICULTY_VALUES = ['easy', 'normal', 'hard'] as const;
export type Difficulty = typeof DIFFICULTY_VALUES[number];

export const TENSION_LEVEL_VALUES = ['low', 'medium', 'high'] as const;
export type TensionLevel = typeof TENSION_LEVEL_VALUES[number];

export const IMPACT_VALUES = ['normal', 'strong', 'extreme'] as const;
export type Impact = typeof IMPACT_VALUES[number];

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  statBonuses?: { might?: number; magic?: number; mischief?: number };
  healValue?: number;
  transferable?: boolean;
  consumable?: boolean;
}

export interface Character {
  id: string;
  name: string;
  class: string;
  species: string;
  quirk: string;
  hp: number;
  max_hp: number;
  status: CharacterStatus;
  avatarUrl?: string;
  avatarPrompt?: string;
  avatarStorageKey?: string;
  avatarStorageProvider?: string;
  gender?: string;
  history?: string;
  stats: {
    might: number;
    magic: number;
    mischief: number;
  };
  inventory: InventoryItem[];
}

export interface InterventionState {
  rescuesUsed: number;
}

export interface SessionState {
  id: string;
  scene: string;
  sceneId: string;
  worldDescription?: string;
  dmPrep?: string;
  dmPrepImageBrief?: string;
  turn: number;
  party: Character[];
  activeCharacterId: string;
  npcs: string[];
  quests: string[];
  lastChoices: Choice[];
  tone: string;
  gameMode?: GameMode;
  recentHistory: string[];
  displayName: string;
  difficulty: string;
  savingsMode: boolean;
  useLocalAI: boolean;
  interventionState: InterventionState;
  storySummary: string;
  gameOver?: boolean;
  previewImageUrl?: string;
}

export interface Choice {
  label: string;
  difficulty: Difficulty;
  stat: Stat;
  difficultyValue?: number;
  narration?: string;
}

export type TurnType = 'normal' | 'intervention' | 'sanctuary';

export interface HpChange {
  characterId: string;
  characterName: string;
  change: number;
  newHp: number;
  maxHp: number;
}

export interface InventoryChange {
  characterName: string;
  itemName: string;
  type: 'added' | 'removed';
}

export interface TurnResult {
  id?: number;
  narration: string;
  choices: Choice[];
  rollNarration?: string;
  imagePrompt: string | null;
  imageSuggested: boolean;
  imageUrl?: string | null;
  suggestedInventoryAdd?: (Omit<InventoryItem, 'id'> & { targetCharacterName?: string }) | null;
  suggestedInventoryRemove?: { characterName: string; itemName: string } | null;
  suggestedRevive?: { characterName: string; hp: number } | null;
  suggestedHeal?: Array<{ characterName: string; hp: number }> | null;
  suggestedDamage?: number | null;
  lastAction?: ActionAttempt | null;
  characterId?: string;
  turnType?: TurnType;
  currentTensionLevel?: TensionLevel;
  hpChanges?: HpChange[];
  inventoryChanges?: InventoryChange[];
}

export interface ActionAttempt {
  actionAttempt: string;
  actionResult: {
    success: boolean;
    roll: number;
    statUsed: Stat | 'none';
    statBonus?: number;
    itemBonus?: number;
    impact?: Impact;
    isCritical?: boolean;
    difficultyTarget?: number;
  };
}

export interface AIInput extends SessionState, ActionAttempt {
  characterId: string;
  interventionRescue?: boolean;
  sanctuaryRecovery?: boolean;
}
