import type { NarrationInput, NarrationOutput } from './NarrationProvider.js';

const cleanLabel = (text: string): string => text.trim().replace(/\s+/g, ' ').replace(/[.?!]+$/g, '');

const sceneNoun = (scene: string): string => {
  const cleaned = cleanLabel(scene);
  if (!cleaned) {
    return 'the area';
  }
  return cleaned.length > 44 ? `${cleaned.slice(0, 41).trim()}...` : cleaned;
};

const nextBeat = (input: NarrationInput, scene: string): string => {
  if (input.sceneMomentum?.suggestedNextBeat) {
    return input.sceneMomentum.suggestedNextBeat;
  }
  if (input.sceneMomentum?.directive === 'victory_exit') {
    return `A way forward opens beyond ${scene}.`;
  }
  if (input.sceneMomentum?.directive === 'advance_campaign') {
    return `Something stirs in ${scene} and demands the party's attention.`;
  }
  if (input.sceneMomentum?.directive === 'climax_pressure') {
    return `A shadow of worse things falls across ${scene}.`;
  }
  return `${scene} is not the same as it was a moment ago.`;
};

export function buildNarrationFallback(input: NarrationInput): NarrationOutput {
  const actor = input.actingCharacterName ?? input.party.find(character => character.status === 'active')?.name ?? 'The party';
  const scene = sceneNoun(input.scene);
  const action = cleanLabel(input.actionAttempt);
  const succeeded = input.actionResult.success;
  const beat = nextBeat(input, scene);
  // Avoid "Actor's Actor does something" when the action already starts with the actor's name.
  const actionText = !action
    ? `${actor}'s move`
    : action.toLowerCase().startsWith(actor.toLowerCase())
      ? action
      : `${actor}'s ${action}`;
  const result = succeeded
    ? `${actionText} works. ${beat}`
    : `${actionText} falls short. ${beat}`;

  return {
    narration: result,
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
    suggestedEncounterStart: null,
    suggestedEncounterUpdate: null,
  };
}
