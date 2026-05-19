import type { NarrationInput, NarrationOutput } from './NarrationProvider.js';

const cleanLabel = (text: string): string => text.trim().replace(/\s+/g, ' ').replace(/[.?!]+$/g, '');
const normalizedText = (text: string): string => text.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, ' ').replace(/\s+/g, ' ').trim();

const INTERNAL_GUIDANCE_FRAGMENTS = [
  'connect this turn to the main threat',
  'push toward a climactic confrontation',
  'introduce a concrete new beat',
  'move from the resolved fight',
  'carry the party',
  'end the current fight decisively',
  'keep the current challenge active',
  'start a concrete scene beat',
  'use suggestedencounterstart',
  'suggestedencounterstart',
  'dmprepencounters',
  'scenemomentum',
  'suggestednextbeat',
] as const;

const isInternalGuidance = (text: string): boolean => {
  const normalized = normalizedText(text);
  return INTERNAL_GUIDANCE_FRAGMENTS.some(fragment => normalized.includes(fragment));
};

const sceneNoun = (scene: string): string => {
  const cleaned = cleanLabel(scene);
  if (!cleaned) {
    return 'the area';
  }
  return cleaned.length > 44 ? `${cleaned.slice(0, 41).trim()}...` : cleaned;
};

const nextBeat = (input: NarrationInput, scene: string): string => {
  if (input.sceneMomentum?.suggestedNextBeat && !isInternalGuidance(input.sceneMomentum.suggestedNextBeat)) {
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

const combatFallbackChoices = (enemyName: string, difficulty: number): NarrationOutput['choices'] => [
  {
    label: `Press the attack against ${enemyName}`,
    difficulty: 'normal',
    stat: 'might',
    difficultyValue: difficulty,
    narration: 'Strike before the enemy recovers.',
  },
  {
    label: `Find an opening in ${enemyName}'s defenses`,
    difficulty: 'normal',
    stat: 'mischief',
    difficultyValue: Math.max(difficulty - 1, 8),
    narration: 'Watch for the moment the enemy overextends.',
  },
  {
    label: `Channel magic to weaken ${enemyName}`,
    difficulty: 'normal',
    stat: 'magic',
    difficultyValue: difficulty,
    narration: 'Turn the tide with arcane force.',
  },
];

export function buildNarrationFallback(input: NarrationInput): NarrationOutput {
  const actor = input.actingCharacterName ?? input.party.find(character => character.status === 'active')?.name ?? 'The party';
  const activeEncounter = input.encounterState?.status === 'active' ? input.encounterState : null;
  const scene = activeEncounter
    ? sceneNoun(activeEncounter.areas?.[0]?.label ?? activeEncounter.name)
    : sceneNoun(input.scene);
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

  const activeEnemy = activeEncounter?.enemies?.find(e => e.status === 'active');
  const choices = activeEnemy
    ? combatFallbackChoices(activeEnemy.name, input.scenePressure?.kind === 'combat' ? 13 : 12)
    : [
      {
        label: `Press deeper into ${scene}`,
        difficulty: 'normal' as const,
        stat: 'might' as const,
        difficultyValue: 12,
        narration: 'Push forward before the situation settles.',
      },
      {
        label: `Search ${scene} for a clue`,
        difficulty: 'normal' as const,
        stat: 'mischief' as const,
        difficultyValue: 11,
        narration: 'Look for the detail everyone else missed.',
      },
      {
        label: `Read the magic around ${scene}`,
        difficulty: 'normal' as const,
        stat: 'magic' as const,
        difficultyValue: 12,
        narration: 'Sense what is hidden or changing nearby.',
      },
    ];

  return {
    narration: result,
    choices,
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
