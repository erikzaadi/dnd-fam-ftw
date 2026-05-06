export type CharacterStatus = 'active' | 'downed';

export type GameMode = 'cinematic' | 'balanced' | 'fast' | 'zug-ma-geddon';
export type Stat = 'might' | 'magic' | 'mischief';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type TensionLevel = 'low' | 'medium' | 'high';
export type Impact = 'normal' | 'strong' | 'extreme';
export type ChoiceFlavor = 'standard' | 'spotlight' | 'combo' | 'social' | 'item' | 'environment';

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  statBonuses?: { might?: number; magic?: number; mischief?: number };
  healValue?: number;
  transferable?: boolean;
  consumable?: boolean;
  tags?: string[];
  effect?: string;
  charges?: number;
  condition?: string;
  boundToCharacterId?: string;
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
  sessionName?: string;
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

export interface Choice {
  label: string;
  difficulty: Difficulty;
  stat: Stat;
  difficultyValue?: number;
  narration?: string;
  riddleAnswer?: string;
  riddleCorrect?: boolean;
  flavor?: ChoiceFlavor;
  helperCharacterName?: string;
  itemOwnerName?: string;
  itemName?: string;
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
  type: 'added' | 'removed' | 'updated';
}

export interface ActionAttempt {
  actionAttempt: string;
  actionResult: {
    success: boolean;
    roll: number;
    statUsed: Stat | 'none';
    statBonus?: number;
    itemBonus?: number;
    helperBonus?: number;
    helperCharacterName?: string;
    choiceItemBonus?: number;
    choiceItemName?: string;
    choiceItemOwnerName?: string;
    impact?: Impact;
    isCritical?: boolean;
    difficultyTarget?: number;
  };
}

export interface TurnResult {
  id?: number;
  narration: string;
  choices: Choice[];
  rollNarration?: string;
  imagePrompt: string | null;
  imageSuggested: boolean;
  imageUrl?: string | null;
  suggestedInventoryAdd?: (Omit<InventoryItem, 'id'> & { targetCharacterName?: string; boundToCharacterName?: string }) | null;
  suggestedInventoryRemove?: { characterName: string; itemName: string } | null;
  suggestedInventoryUpdate?: {
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

export interface SessionPreview {
  id: string;
  displayName: string;
  worldDescription?: string;
  storySummary?: string;
  dmPrep?: string;
  difficulty: string;
  gameMode: string;
  gameOver?: boolean;
  previewImageUrl?: string;
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
  gameMode?: GameMode;
  interventionState: InterventionState;
  gameOver?: boolean;
  previewImageUrl?: string;
}

export interface AppSettings {
  imagesEnabled: boolean;
  defaultUseLocalAI: boolean;
}

export interface Capabilities {
  hasLocalAI: boolean;
  hasCloudAI: boolean;
  hasTts: boolean;
}
