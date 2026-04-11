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

export interface Session {
  id: string;
  scene: string;
  turn: number;
  party: Character[];
  activeCharacterId: string;
  displayName: string;
  savingsMode: boolean;
  useLocalAI: boolean;
}

export interface TurnResult {
  narration: string;
  choices: Choice[];
  imagePrompt: string | null;
  imageSuggested: boolean;
  imageUrl?: string | null;
  suggestedInventoryAdd?: InventoryItem | null;
  lastAction?: ActionAttempt | null;
  characterId?: string;
}
