import type { NarrationInput, NarrationOutput } from './NarrationProvider.js';

const cleanLabel = (text: string): string => text.trim().replace(/\s+/g, ' ').replace(/[.?!]+$/g, '');

const sceneNoun = (scene: string): string => {
  const cleaned = cleanLabel(scene);
  if (!cleaned) {
    return 'the area';
  }
  return cleaned.length > 44 ? `${cleaned.slice(0, 41).trim()}...` : cleaned;
};

export function buildNarrationFallback(input: NarrationInput): NarrationOutput {
  const actor = input.actingCharacterName ?? input.party.find(character => character.status === 'active')?.name ?? 'The party';
  const nextActor = input.nextCharacterName ?? actor;
  const scene = sceneNoun(input.scene);
  const action = cleanLabel(input.actionAttempt);
  const succeeded = input.actionResult.success;
  const result = succeeded
    ? `${actor}'s ${action || 'move'} works, giving the party a clearer angle on ${scene}.`
    : `${actor}'s ${action || 'move'} does not land cleanly, but it reveals a new pressure point in ${scene}.`;

  return {
    narration: `${result} ${nextActor} has the next move as the situation shifts.`,
    choices: [
      {
        label: `Press deeper into ${scene}`,
        difficulty: 'normal',
        stat: 'might',
        difficultyValue: 12,
        narration: 'Push forward before the situation settles.',
      },
      {
        label: `Search ${scene} for a clue`,
        difficulty: 'normal',
        stat: 'mischief',
        difficultyValue: 11,
        narration: 'Look for the detail everyone else missed.',
      },
      {
        label: `Read the magic around ${scene}`,
        difficulty: 'normal',
        stat: 'magic',
        difficultyValue: 12,
        narration: 'Sense what is hidden or changing nearby.',
      },
    ],
    imagePrompt: null,
    imageSuggested: false,
    currentTensionLevel: input.scenePressure?.kind === 'combat' || input.gameMode === 'zug-ma-geddon'
      ? 'high'
      : 'medium',
    suggestedInventoryAdd: null,
    suggestedInventoryRemove: null,
    suggestedInventoryUpdate: null,
    suggestedRevive: null,
    suggestedHeal: null,
    suggestedBuffAdd: null,
    suggestedBuffRemove: null,
    suggestedDamage: null,
  };
}
