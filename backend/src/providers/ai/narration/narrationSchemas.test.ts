import { describe, expect, it } from 'vitest';
import { narrationOutputSchema } from './narrationSchemas.js';

describe('narrationOutputSchema', () => {
  it('accepts difficultyValue 1 for nearly automatic actions', () => {
    const result = narrationOutputSchema.safeParse({
      narration: 'A portal opens with a low violet hum.',
      choices: [
        { label: 'Enter the portal', difficulty: 'easy', stat: 'magic', difficultyValue: 1 },
        { label: 'Check the threshold', difficulty: 'easy', stat: 'mischief', difficultyValue: 6 },
        { label: 'Brace and charge through', difficulty: 'normal', stat: 'might', difficultyValue: 10 },
      ],
      imagePrompt: null,
      imageSuggested: false,
      currentTensionLevel: 'medium',
      suggestedInventoryAdd: null,
    });

    expect(result.success).toBe(true);
  });

  it('requires difficultyValue on every choice', () => {
    const result = narrationOutputSchema.safeParse({
      narration: 'The corridor narrows into darkness.',
      choices: [
        { label: 'Press on', difficulty: 'easy', stat: 'might', difficultyValue: 8 },
        { label: 'Sneak ahead', difficulty: 'normal', stat: 'mischief' },
        { label: 'Light the way', difficulty: 'normal', stat: 'magic', difficultyValue: 11 },
      ],
      imagePrompt: null,
      imageSuggested: false,
      currentTensionLevel: 'medium',
      suggestedInventoryAdd: null,
    });

    expect(result.success).toBe(false);
  });

  it('accepts structured riddle answer choices', () => {
    const result = narrationOutputSchema.safeParse({
      narration: 'Fiddlewick asks, "What runs but never walks?"',
      choices: [
        { label: 'Answer: a river', difficulty: 'normal', stat: 'mischief', difficultyValue: 12, narration: 'The old riddle may have a flowing answer.', riddleAnswer: 'a river', riddleCorrect: true },
        { label: 'Answer: a shadow', difficulty: 'normal', stat: 'mischief', difficultyValue: 12, narration: 'A gloomy answer could fit the realm.', riddleAnswer: 'a shadow', riddleCorrect: false },
        { label: 'Ask Fiddlewick for a hint', difficulty: 'easy', stat: 'mischief', difficultyValue: 8, narration: 'A clever question may reveal another clue.' },
      ],
      imagePrompt: null,
      imageSuggested: false,
      currentTensionLevel: 'medium',
      suggestedInventoryAdd: null,
    });

    expect(result.success).toBe(true);
  });
});
