export type NarrationChoice = {
  label: string;
  difficulty: 'easy' | 'normal' | 'hard';
  stat: 'might' | 'magic' | 'mischief';
};

export type NarrationInput = {
  scene: string;
  party: Array<{
    name: string;
    class: string;
    hp: number;
    maxHp: number;
    quirk?: string;
  }>;
  inventory: Array<{
    name: string;
    description: string;
    statBonuses: { might?: number; magic?: number; mischief?: number };
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
  } | null;
};

export interface NarrationProvider {
  generateTurn(input: NarrationInput): Promise<NarrationOutput>;
}
