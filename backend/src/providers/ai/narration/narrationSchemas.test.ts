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
});
