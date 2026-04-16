export const DIFF_THRESHOLDS: Record<string, number> = { easy: 8, normal: 12, hard: 16 };

export const beatTarget = (difficultyValue: number | undefined, difficulty: string): number =>
  difficultyValue ?? DIFF_THRESHOLDS[difficulty] ?? 12;
