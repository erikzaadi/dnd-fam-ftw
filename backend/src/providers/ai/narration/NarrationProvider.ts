export type NarrationChoice = {
  label: string;
  difficulty: 'easy' | 'normal' | 'hard';
  stat: 'might' | 'magic' | 'mischief';
};

export type NarrationInput = {
  scene: string;
  storySummary?: string;
  actingCharacterName?: string;
  nextCharacterName?: string;
  party: Array<{
    name: string;
    class: string;
    hp: number;
    maxHp: number;
    status: 'active' | 'downed';
    quirk?: string;
    gender?: string;
    history?: string;
  }>;
  inventory: Array<{
    ownerName: string;
    name: string;
    description: string;
    statBonuses: { might?: number; magic?: number; mischief?: number };
    healValue?: number;
    consumable?: boolean;
    transferable?: boolean;
  }>;
  actionAttempt: string;
  actionResult: {
    success: boolean;
    roll?: number;
    statUsed?: 'might' | 'magic' | 'mischief';
    difficulty?: string;
    summary: string;
  };
  recentHistory: string[];
  tone: string;
  gameMode?: 'cinematic' | 'balanced' | 'fast' | 'zug-ma-geddon';
  isFirstTurn?: boolean;
  interventionRescue?: boolean;
  sanctuaryRecovery?: boolean;
};

export type NarrationOutput = {
  narration: string;
  choices: NarrationChoice[];
  rollNarration?: string;
  imagePrompt: string | null;
  imageSuggested: boolean;
  currentTensionLevel: 'low' | 'medium' | 'high';
  suggestedInventoryAdd: {
    name: string;
    description: string;
    targetCharacterName?: string;
    statBonuses: { might?: number; magic?: number; mischief?: number };
    healValue?: number;
    consumable?: boolean;
    transferable?: boolean;
  } | null;
  suggestedInventoryRemove: { characterName: string; itemName: string } | null;
  suggestedRevive: { characterName: string; hp: number } | null;
  suggestedHeal: Array<{ characterName: string; hp: number }> | null;
  suggestedDamage: number | null;
};

export interface NarrationProvider {
  generateTurn(input: NarrationInput): Promise<NarrationOutput>;
}
