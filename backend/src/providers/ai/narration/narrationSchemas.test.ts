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
      currentTensionLevel: 'medium',
      suggestedInventoryAdd: null,
    });

    expect(result.success).toBe(true);
  });

  it('accepts environment feature metadata on obstacle choices', () => {
    const result = narrationOutputSchema.safeParse({
      narration: 'The bridge stones begin dropping into a misty ravine.',
      choices: [
        { label: 'Sprint across the falling stones', difficulty: 'normal', stat: 'might', difficultyValue: 11, flavor: 'environment', environmentFeature: 'falling bridge stones' },
        { label: 'Time each step between gaps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Stabilize the bridge with a spell', difficulty: 'hard', stat: 'magic', difficultyValue: 15 },
      ],
      imagePrompt: null,
      imageSuggested: false,
      currentTensionLevel: 'high',
      suggestedInventoryAdd: null,
    });

    expect(result.success).toBe(true);
  });
});
