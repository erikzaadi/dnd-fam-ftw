export type NarrationChoice = {
  label: string;
  difficulty: 'easy' | 'normal' | 'hard';
  stat: 'might' | 'magic' | 'mischief';
};

export type NarrationInput = {
  scene: string;
  storySummary?: string;
  party: Array<{
    name: string;
    class: string;
    hp: number;
    maxHp: number;
    status: 'active' | 'downed';
    quirk?: string;
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
  isFirstTurn?: boolean;
  interventionRescue?: boolean;
};

export type NarrationOutput = {
  narration: string;
  choices: NarrationChoice[];
  imagePrompt: string | null;
  imageSuggested: boolean;
  suggestedInventoryAdd: {
    name: string;
    description: string;
    statBonuses: { might?: number; magic?: number; mischief?: number };
    healValue?: number;
    consumable?: boolean;
    transferable?: boolean;
  } | null;
};

export interface NarrationProvider {
  generateTurn(input: NarrationInput): Promise<NarrationOutput>;
}
