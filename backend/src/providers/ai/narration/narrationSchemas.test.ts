import { describe, expect, it } from 'vitest';
import { choiceSchema } from './narrationSchemas.js';

describe('choiceSchema', () => {
  it('accepts difficultyValue 1 for nearly automatic actions', () => {
    const result = choiceSchema.safeParse(
      { label: 'Enter the portal', difficulty: 'easy', stat: 'magic', difficultyValue: 1 },
    );

    expect(result.success).toBe(true);
  });

  it('requires difficultyValue', () => {
    const result = choiceSchema.safeParse(
      { label: 'Sneak ahead', difficulty: 'normal', stat: 'mischief' },
    );

    expect(result.success).toBe(false);
  });

  it('accepts structured riddle answer choices', () => {
    const result = choiceSchema.safeParse(
      { label: 'Answer: a river', difficulty: 'normal', stat: 'mischief', difficultyValue: 12, narration: 'The old riddle may have a flowing answer.', riddleAnswer: 'a river', riddleCorrect: true },
    );

    expect(result.success).toBe(true);
  });

  it('accepts environment feature metadata on obstacle choices', () => {
    const result = choiceSchema.safeParse(
      { label: 'Sprint across the falling stones', difficulty: 'normal', stat: 'might', difficultyValue: 11, flavor: 'environment', environmentFeature: 'falling bridge stones' },
    );

    expect(result.success).toBe(true);
  });
});
