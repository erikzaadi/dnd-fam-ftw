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
}

export interface TurnResult {
  narration: string;
  choices: Choice[];
  imagePrompt: string | null;
  imageSuggested: boolean;
  imageUrl?: string | null;
  suggestedInventoryAdd?: Omit<InventoryItem, 'id'> | null;
  lastAction?: ActionAttempt | null;
  characterId?: string;
}

export interface ActionAttempt {
  actionAttempt: string;
  actionResult: {
    success: boolean;
    roll: number;
    statUsed: 'might' | 'magic' | 'mischief' | 'none';
    itemBonus?: number;
  };
}

export interface AIInput extends SessionState, ActionAttempt {
  interventionRescue?: boolean;
}
