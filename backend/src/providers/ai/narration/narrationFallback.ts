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
  const suggested = cleanLabel(input.sceneMomentum?.suggestedNextBeat ?? '');
  if (input.sceneMomentum?.directive === 'victory_exit') {
    return suggested || `The resolved danger stays behind them as the party reaches a fresh route beyond ${scene}.`;
  }
  if (input.sceneMomentum?.directive === 'advance_campaign') {
    return suggested || `A fresh clue, route, or witness changes what the party can do in ${scene}.`;
  }
  if (input.sceneMomentum?.directive === 'climax_pressure') {
    return suggested || `The main threat leaves a clear mark on ${scene}, pointing the party toward the next confrontation.`;
  }
  return suggested || `The situation shifts in ${scene}.`;
};

export function buildNarrationFallback(input: NarrationInput): NarrationOutput {
  const actor = input.actingCharacterName ?? input.party.find(character => character.status === 'active')?.name ?? 'The party';
  const nextActor = input.nextCharacterName ?? actor;
  const scene = sceneNoun(input.scene);
  const action = cleanLabel(input.actionAttempt);
  const succeeded = input.actionResult.success;
  const beat = nextBeat(input, scene);
  const result = succeeded
    ? `${actor}'s ${action || 'move'} works. ${beat}`
    : `${actor}'s ${action || 'move'} does not land cleanly, but it still exposes what must happen next. ${beat}`;

  return {
    narration: `${result} ${nextActor} has the next move from this new position.`,
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
