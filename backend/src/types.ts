export type CharacterStatus = 'active' | 'downed';

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
  used: boolean;
}

export interface SessionState {
  id: string;
  scene: string;
  sceneId: string;
  worldDescription?: string;
  turn: number;
  party: Character[];
  activeCharacterId: string;
  npcs: string[];
  quests: string[];
  lastChoices: Choice[];
  tone: string;
  gameMode?: 'cinematic' | 'balanced' | 'fast' | 'zug-ma-geddon';
  recentHistory: string[];
  displayName: string;
  difficulty: string;
  savingsMode: boolean;
  useLocalAI: boolean;
  interventionState: InterventionState;
  storySummary: string;
}

export interface Choice {
  label: string;
  difficulty: 'easy' | 'normal' | 'hard';
  stat: 'might' | 'magic' | 'mischief';
  difficultyValue?: number;
}

export type TurnType = 'normal' | 'intervention' | 'sanctuary';

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
  currentTensionLevel?: 'low' | 'medium' | 'high';
}

export interface ActionAttempt {
  actionAttempt: string;
  actionResult: {
    success: boolean;
    roll: number;
    statUsed: 'might' | 'magic' | 'mischief' | 'none';
    statBonus?: number;
    itemBonus?: number;
    isCritical?: boolean;
    difficultyTarget?: number;
  };
}

export interface AIInput extends SessionState, ActionAttempt {
  characterId: string;
  interventionRescue?: boolean;
  sanctuaryRecovery?: boolean;
}
