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
  gender?: string;
  sessionName?: string;
  stats: {
    might: number;
    magic: number;
    mischief: number;
  };
  inventory: InventoryItem[];
}

export interface Choice {
  label: string;
  difficulty: 'easy' | 'normal' | 'hard';
  stat: 'might' | 'magic' | 'mischief';
  difficultyValue?: number;
  narration?: string;
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

export interface SessionPreview {
  id: string;
  displayName: string;
  worldDescription?: string;
  storySummary?: string;
  dmPrep?: string;
  difficulty: string;
  gameMode: string;
  gameOver?: boolean;
  party: { id: string; name: string; class: string; species: string; avatarUrl?: string; hp: number; max_hp: number }[];
}

export interface Session {
  id: string;
  scene: string;
  turn: number;
  party: Character[];
  activeCharacterId: string;
  displayName: string;
  savingsMode: boolean;
  useLocalAI: boolean;
  gameMode?: 'cinematic' | 'balanced' | 'fast';
  interventionState: { rescuesUsed: number };
  gameOver?: boolean;
}

export type TurnType = 'normal' | 'intervention' | 'sanctuary';

export interface HpChange {
  characterId: string;
  characterName: string;
  change: number;
  newHp: number;
  maxHp: number;
}

export interface TurnResult {
  id?: number;
  narration: string;
  choices: Choice[];
  rollNarration?: string;
  imagePrompt: string | null;
  imageSuggested: boolean;
  imageUrl?: string | null;
  suggestedInventoryAdd?: InventoryItem | null;
  lastAction?: ActionAttempt | null;
  characterId?: string;
  turnType?: TurnType;
  currentTensionLevel?: 'low' | 'medium' | 'high';
  hpChanges?: HpChange[];
}
