import { describe, expect, it } from 'vitest';
import type { Choice } from '../types.js';
import { resolveRiddleAnswer } from './riddleService.js';

const choices: Choice[] = [
  { label: 'Answer: a river', difficulty: 'normal', stat: 'mischief', difficultyValue: 12, riddleAnswer: 'a river', riddleCorrect: true },
  { label: 'Answer: a shadow', difficulty: 'normal', stat: 'mischief', difficultyValue: 12, riddleAnswer: 'a shadow', riddleCorrect: false },
  { label: 'Ask Fiddlewick for a hint', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
];

describe('resolveRiddleAnswer', () => {
  it('resolves the correct suggested answer without a roll', () => {
    const attempt = resolveRiddleAnswer('Answer: a river', choices);

    expect(attempt?.actionResult).toMatchObject({ success: true, roll: 0, statUsed: 'none' });
  });

  it('resolves a wrong suggested answer without a roll', () => {
    const attempt = resolveRiddleAnswer('Answer: a shadow', choices);

    expect(attempt?.actionResult).toMatchObject({ success: false, roll: 0, statUsed: 'none' });
  });

  it('matches typed correct answers in custom action text', () => {
    const attempt = resolveRiddleAnswer('Solve the riddle with the answer: "A river"', choices);

    expect(attempt?.actionResult).toMatchObject({ success: true, roll: 0, statUsed: 'none' });
  });

  it('leaves non-answer actions for normal resolution', () => {
    expect(resolveRiddleAnswer('Ask Fiddlewick for a hint', choices)).toBeNull();
  });
});
