import { describe, expect, it } from 'vitest';
import type { NarrationInput, NarrationOutput } from './NarrationProvider.js';
import { parseNarrationOutput } from './narrationOutputGuards.js';

const input: NarrationInput = {
  scene: 'A ruined keep',
  party: [
    { name: 'Pip', class: 'Rogue', species: 'Halfling', hp: 8, maxHp: 8, stats: { might: 2, magic: 1, mischief: 5 }, status: 'active' },
  ],
  inventory: [],
  actionAttempt: 'Search the hall',
  actionResult: { success: true, summary: 'The action succeeded.' },
  recentHistory: [],
  tone: 'playful',
  gameMode: 'fast',
};

const output = (overrides: Partial<NarrationOutput> = {}): NarrationOutput => ({
  narration: 'Pip finds a cracked staircase leading deeper into the keep.',
  choices: [
    { label: 'Follow the stairs', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
    { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
    { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
  ],
  rollNarration: 'No roll was needed.',
  imagePrompt: null,
  imageSuggested: false,
  currentTensionLevel: 'medium',
  suggestedInventoryAdd: null,
  suggestedInventoryRemove: null,
  suggestedInventoryUpdate: null,
  suggestedRevive: null,
  suggestedHeal: null,
  suggestedBuffAdd: null,
  suggestedBuffRemove: null,
  suggestedDamage: null,
  ...overrides,
});

describe('parseNarrationOutput', () => {
  it('normalizes zug-ma-geddon output to high tension', () => {
    const result = parseNarrationOutput({ ...input, gameMode: 'zug-ma-geddon' }, output({
      currentTensionLevel: 'medium',
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currentTensionLevel).toBe('high');
    }
  });

  it('normalizes combat scene pressure to high tension', () => {
    const result = parseNarrationOutput({
      ...input,
      scenePressure: {
        kind: 'combat',
        pressureTurns: 1,
        successfulPressureTurns: 0,
        previousTensionLevels: ['medium'],
        reason: 'Combat pressure should drive high tension.',
      },
    }, output({
      currentTensionLevel: 'medium',
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currentTensionLevel).toBe('high');
    }
  });

  it('downgrades environment choices without an environment feature', () => {
    const result = parseNarrationOutput(input, output({
      choices: [
        { label: 'Leap across the crumbling stair', difficulty: 'normal', stat: 'might', difficultyValue: 11, flavor: 'environment' },
        { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.choices[0].flavor).toBe('standard');
    }
  });

  it('rejects item choices when the item belongs to a different character than the next actor', () => {
    const result = parseNarrationOutput({
      ...input,
      nextCharacterName: 'Pip',
      party: [
        ...input.party,
        { name: 'Zara', class: 'Mage', species: 'Elf', hp: 8, maxHp: 8, stats: { might: 1, magic: 5, mischief: 2 }, status: 'active' },
      ],
      inventory: [
        { ownerName: 'Zara', name: '✨ Enchanted Oak Token', description: 'Whispers forest secrets.', statBonuses: {} },
      ],
    }, output({
      choices: [
        { label: 'Use Zara\'s token', difficulty: 'normal', stat: 'magic', difficultyValue: 12, flavor: 'item', itemOwnerName: 'Zara', itemName: '✨ Enchanted Oak Token' },
        { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Item choices may only use the next actor');
    }
  });

  it('keeps item choices when the next actor owns the item', () => {
    const result = parseNarrationOutput({
      ...input,
      nextCharacterName: 'Pip',
      inventory: [
        { ownerName: 'Pip', name: '✨ Enchanted Oak Token', description: 'Whispers forest secrets.', statBonuses: {} },
      ],
    }, output({
      choices: [
        { label: 'Use the token', difficulty: 'normal', stat: 'magic', difficultyValue: 12, flavor: 'item', itemOwnerName: 'Pip', itemName: 'Enchanted Oak Token' },
        { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.choices[0]).toMatchObject({
        flavor: 'item',
        itemOwnerName: 'Pip',
        itemName: '✨ Enchanted Oak Token',
      });
    }
  });

  it('rejects item choices that repeat recently suggested gear', () => {
    const result = parseNarrationOutput({
      ...input,
      nextCharacterName: 'Pip',
      previousChoiceItemNames: ['✨ Enchanted Oak Token'],
      inventory: [
        { ownerName: 'Pip', name: '✨ Enchanted Oak Token', description: 'Whispers forest secrets.', statBonuses: {} },
      ],
    }, output({
      choices: [
        { label: 'Use the token again', difficulty: 'normal', stat: 'magic', difficultyValue: 12, flavor: 'item', itemOwnerName: 'Pip', itemName: '✨ Enchanted Oak Token' },
        { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('repeats recently suggested gear');
    }
  });

  it('allows more than two bonus-bearing choices without discarding a successful party heal', () => {
    const result = parseNarrationOutput({ ...input, actionAttempt: 'Heal the party' }, output({
      narration: 'Pip chants a bright healing rhyme, and the whole party steadies themselves.',
      choices: [
        { label: 'Use Pip\'s rogue nerve', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, flavor: 'spotlight' },
        { label: 'Talk down the keep spirit', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, flavor: 'social' },
        { label: 'Lean into Pip\'s halfling luck', difficulty: 'easy', stat: 'mischief', difficultyValue: 8, flavor: 'spotlight' },
      ],
      suggestedHeal: [{ characterName: 'Pip', hp: 3 }],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggestedHeal).toEqual([{ characterName: 'Pip', hp: 3 }]);
    }
  });

  it('strips suggestedHeal when the action was not healing or recovery', () => {
    const result = parseNarrationOutput({ ...input, actionAttempt: 'Strike the enemy' }, output({
      narration: 'Pip lands a solid blow.',
      suggestedHeal: [{ characterName: 'Pip', hp: 2 }],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggestedHeal).toBeNull();
    }
  });

  it('strips em dashes from narration fields', () => {
    const result = parseNarrationOutput(input, output({
      narration: 'Pip finds a clue — then pockets it.',
      rollNarration: 'No roll — just nerve.',
      choices: [
        { label: 'Follow the clue — carefully', difficulty: 'easy', stat: 'mischief', difficultyValue: 8, narration: 'Move — quietly.' },
        { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.narration).not.toContain('—');
      expect(result.data.rollNarration).not.toContain('—');
      expect(result.data.choices[0].label).not.toContain('—');
      expect(result.data.choices[0].narration).not.toContain('—');
    }
  });

  it('keeps valid buff suggestions for active characters', () => {
    const result = parseNarrationOutput(input, output({
      suggestedBuffAdd: {
        characterName: 'Pip',
        name: 'Blessed',
        description: 'A quick blessing sharpens Pip.',
        statBonuses: { mischief: 1 },
        remainingTurns: 2,
      },
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggestedBuffAdd?.characterName).toBe('Pip');
    }
  });

  it('strips buff suggestions for downed targets', () => {
    const result = parseNarrationOutput({
      ...input,
      party: [{ ...input.party[0], status: 'downed' }],
    }, output({
      suggestedBuffAdd: {
        characterName: 'Pip',
        name: 'Blessed',
        description: 'A quick blessing sharpens Pip.',
        statBonuses: { mischief: 1 },
        remainingTurns: 2,
      },
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.suggestedBuffAdd).toBeNull();
    }
  });

  it('downgrades combo choices with an invalid helper to standard', () => {
    const result = parseNarrationOutput(input, output({
      choices: [
        { label: 'Team up with Zara', difficulty: 'easy', stat: 'magic', difficultyValue: 8, flavor: 'combo', helperCharacterName: 'Zara' },
        { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.choices[0].flavor).toBe('standard');
      expect(result.data.choices[0].helperCharacterName).toBeUndefined();
    }
  });

  it('canonicalizes item choice names when the model omits the leading emoji', () => {
    const result = parseNarrationOutput({
      ...input,
      inventory: [
        { ownerName: 'Pip', name: '🧭 Brass Compass', description: 'Points to safe paths', statBonuses: {} },
      ],
    }, output({
      choices: [
        { label: 'Follow the Brass Compass', difficulty: 'easy', stat: 'mischief', difficultyValue: 8, flavor: 'item', itemOwnerName: 'Pip', itemName: 'Brass Compass' },
        { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.choices[0].itemName).toBe('🧭 Brass Compass');
    }
  });

  it('downgrades invalid item choices instead of discarding the resolved turn', () => {
    const result = parseNarrationOutput(input, output({
      choices: [
        { label: 'Ring your bell to call for aid', difficulty: 'hard', stat: 'might', difficultyValue: 15, flavor: 'item', itemOwnerName: 'Oswin Bell', itemName: 'Bell of Summoning' },
        { label: 'Check for traps', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.choices[0].flavor).toBe('standard');
      expect(result.data.choices[0].itemOwnerName).toBeUndefined();
      expect(result.data.choices[0].itemName).toBeUndefined();
    }
  });

  it('rejects victory exits that do not move into a new beat', () => {
    const result = parseNarrationOutput({
      ...input,
      sceneMomentum: {
        directive: 'victory_exit',
        staleChoiceCount: 0,
        turnsSinceSceneChange: 2,
        turnsSinceCombat: 1,
        justCompletedCombat: true,
        justCompletedDifficultChallenge: false,
        suggestedNextBeat: 'Move into the next chamber.',
        reason: 'Combat completed.',
      },
    }, output({
      narration: 'The last foe falls, and everyone catches their breath.',
      choices: [
        { label: 'Attack the foe again', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
        { label: 'Strike the foe harder', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
        { label: 'Fight the foe back', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
      ],
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Victory exit');
    }
  });

  it('allows victory exits that place choices in the new beat', () => {
    const result = parseNarrationOutput({
      ...input,
      sceneMomentum: {
        directive: 'victory_exit',
        staleChoiceCount: 0,
        turnsSinceSceneChange: 2,
        turnsSinceCombat: 1,
        justCompletedCombat: true,
        justCompletedDifficultChallenge: false,
        suggestedNextBeat: 'Move into the next chamber.',
        reason: 'Combat completed.',
      },
    }, output({
      narration: 'The last foe falls, and the party follows a smoking stair into a furnace chamber.',
      choices: [
        { label: 'Unlock the furnace door', difficulty: 'normal', stat: 'mischief', difficultyValue: 12 },
        { label: 'Follow the smoke trail', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
        { label: 'Ask Pip to guard the stair', difficulty: 'normal', stat: 'might', difficultyValue: 11 },
      ],
    }));

    expect(result.success).toBe(true);
  });

  it('rejects victory exits with multiple attack-shaped choices', () => {
    const result = parseNarrationOutput({
      ...input,
      sceneMomentum: {
        directive: 'victory_exit',
        staleChoiceCount: 0,
        turnsSinceSceneChange: 2,
        turnsSinceCombat: 1,
        justCompletedCombat: true,
        justCompletedDifficultChallenge: false,
        suggestedNextBeat: 'Move into the next chamber.',
        reason: 'Combat completed.',
      },
    }, output({
      narration: 'The last foe falls, and the party follows a smoking stair into a furnace chamber.',
      choices: [
        { label: 'Attack the furnace guard', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
        { label: 'Strike the shadow near the door', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
        { label: 'Follow the smoke trail', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
      ],
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('No more than one choice');
    }
  });

  it('rejects repeated vague atmosphere filler', () => {
    const result = parseNarrationOutput({
      ...input,
      recentHistory: ['Tension hangs in the air as the hallway waits.'],
      sceneMomentum: {
        directive: 'press_current_scene',
        staleChoiceCount: 0,
        turnsSinceSceneChange: 1,
        turnsSinceCombat: 3,
        justCompletedCombat: false,
        justCompletedDifficultChallenge: false,
        suggestedNextBeat: 'Keep the current challenge active.',
        reason: 'Pressure continues.',
      },
    }, output({
      narration: 'Tension hangs in the air as Pip studies the same hallway.',
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('vague atmosphere');
    }
  });

  it('rejects stale generic repeated choice labels', () => {
    const result = parseNarrationOutput({
      ...input,
      previousChoiceLabels: ['Search the room'],
      sceneMomentum: {
        directive: 'press_current_scene',
        staleChoiceCount: 1,
        turnsSinceSceneChange: 1,
        turnsSinceCombat: 3,
        justCompletedCombat: false,
        justCompletedDifficultChallenge: false,
        suggestedNextBeat: 'Keep the current challenge active.',
        reason: 'Pressure continues.',
      },
    }, output({
      choices: [
        { label: 'Search the room', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
        { label: 'Check the silver door', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('stale generic');
    }
  });

  it('rejects repeated hidden-path continuity loops', () => {
    const result = parseNarrationOutput({
      ...input,
      recentHistory: ['Pip found a hidden path behind the blue flowers.'],
      sceneMomentum: {
        directive: 'press_current_scene',
        staleChoiceCount: 0,
        turnsSinceSceneChange: 2,
        turnsSinceCombat: 3,
        justCompletedCombat: false,
        justCompletedDifficultChallenge: false,
        suggestedNextBeat: 'Pay off the discovered route.',
        reason: 'Pressure continues.',
      },
    }, output({
      narration: 'Another hidden path appears behind the same flowers.',
      choices: [
        { label: 'Follow the hidden path', difficulty: 'easy', stat: 'mischief', difficultyValue: 7 },
        { label: 'Check the silver door', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Call for help', difficulty: 'easy', stat: 'magic', difficultyValue: 7 },
      ],
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Hidden-path beat repeats');
    }
  });

  it('rejects portal transitions before a completed combat or difficult challenge', () => {
    const result = parseNarrationOutput({
      ...input,
      sceneMomentum: {
        directive: 'advance_campaign',
        staleChoiceCount: 0,
        turnsSinceSceneChange: 2,
        turnsSinceCombat: 3,
        justCompletedCombat: false,
        justCompletedDifficultChallenge: false,
        suggestedNextBeat: 'Introduce a concrete new beat.',
        reason: 'The scene needs motion.',
      },
    }, output({
      narration: 'A shimmering portal opens at the edge of the clearing.',
      choices: [
        { label: 'Study the portal', difficulty: 'easy', stat: 'magic', difficultyValue: 8 },
        { label: 'Leap through the portal', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
        { label: 'Guard the clearing', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
      ],
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Portal');
    }
  });

  it('allows portal transitions after a completed difficult challenge', () => {
    const result = parseNarrationOutput({
      ...input,
      sceneMomentum: {
        directive: 'victory_exit',
        staleChoiceCount: 0,
        turnsSinceSceneChange: 2,
        turnsSinceCombat: 3,
        justCompletedCombat: false,
        justCompletedDifficultChallenge: true,
        suggestedNextBeat: 'Carry the party past the completed challenge.',
        reason: 'A difficult challenge was completed.',
      },
    }, output({
      narration: 'The bridge runes unlock a portal to the next chamber.',
      choices: [
        { label: 'Enter the next chamber', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
        { label: 'Study the portal runes', difficulty: 'normal', stat: 'magic', difficultyValue: 11 },
        { label: 'Guard the bridge behind you', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
      ],
    }));

    expect(result.success).toBe(true);
  });

  it('rejects narration that repeats the previous turn setup too closely', () => {
    const previous = 'The air is thick with the scent of blooming flowers as the village of Everbloom stands in quiet disarray. Vymeson, Pip, and Thessaly find themselves at the heart of this peaceful settlement, which now buzzes with nervous energy after the theft of the Beacon of Hope. As villagers scurry about, whispering fears of chaos, a sprightly squirrel named Finnian Flickertail bounds toward them, chattering about mischievous pranks and mysterious sightings. The adventure begins as the party learns their mission: to retrieve the Beacon before Lady Umbra\'s twisted melodies reshape reality itself.';
    const repeated = 'The village of Everbloom is awash with vibrant colors, the air sweet with the scent of blooming flowers, yet a shadow hangs over it. Vymeson, Pip, and Thessaly stand in the heart of the village, where whispers of fear ripple through the townsfolk after the theft of the Beacon of Hope. As villagers scuttle about, a squirrel named Finnian Flickertail darts up to the party, his eyes wide with tales of mischief and mysterious sightings. The adventure begins as the party learns they must retrieve the Beacon before Lady Umbra\'s twisted melodies reshape reality itself.';
    const result = parseNarrationOutput({
      ...input,
      recentHistory: [previous],
      sceneMomentum: {
        directive: 'press_current_scene',
        staleChoiceCount: 0,
        turnsSinceSceneChange: 1,
        turnsSinceCombat: 3,
        justCompletedCombat: false,
        justCompletedDifficultChallenge: false,
        suggestedNextBeat: 'Keep the current scene active.',
        reason: 'The party is still in the opening scene.',
      },
    }, output({
      narration: repeated,
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('repeats the previous turn');
    }
  });

  it('allows similar but newly specific choice labels', () => {
    const result = parseNarrationOutput({
      ...input,
      previousChoiceLabels: ['Search the room'],
      sceneMomentum: {
        directive: 'press_current_scene',
        staleChoiceCount: 1,
        turnsSinceSceneChange: 1,
        turnsSinceCombat: 3,
        justCompletedCombat: false,
        justCompletedDifficultChallenge: false,
        suggestedNextBeat: 'Keep the current challenge active.',
        reason: 'Pressure continues.',
      },
    }, output({
      choices: [
        { label: 'Search the silver door', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
        { label: 'Question the candle ghost', difficulty: 'normal', stat: 'magic', difficultyValue: 11 },
        { label: 'Brace the cracked beam', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
      ],
    }));

    expect(result.success).toBe(true);
  });

  it('allows concrete continuity without repeated vague atmosphere filler', () => {
    const result = parseNarrationOutput({
      ...input,
      recentHistory: ['Pip kept the Moon Key hidden near the ruined tower.'],
      sceneMomentum: {
        directive: 'press_current_scene',
        staleChoiceCount: 0,
        turnsSinceSceneChange: 1,
        turnsSinceCombat: 3,
        justCompletedCombat: false,
        justCompletedDifficultChallenge: false,
        suggestedNextBeat: 'Keep the current challenge active.',
        reason: 'Pressure continues.',
      },
    }, output({
      narration: 'Pip lifts the Moon Key beside the ruined tower, and its blue teeth point toward a sealed stairwell.',
      choices: [
        { label: 'Unlock the sealed stairwell', difficulty: 'easy', stat: 'mischief', difficultyValue: 8 },
        { label: 'Study the blue key-teeth', difficulty: 'normal', stat: 'magic', difficultyValue: 11 },
        { label: 'Guard the tower door', difficulty: 'normal', stat: 'might', difficultyValue: 12 },
      ],
    }));

    expect(result.success).toBe(true);
  });

  it('allows victory exits that move into a cavern beat with clues and paths', () => {
    const result = parseNarrationOutput({
      ...input,
      sceneMomentum: {
        directive: 'victory_exit',
        staleChoiceCount: 0,
        turnsSinceSceneChange: 3,
        turnsSinceCombat: 0,
        justCompletedCombat: true,
        justCompletedDifficultChallenge: false,
        suggestedNextBeat: 'Move from the resolved fight into the next clue, route, reward, threat, or decision.',
        reason: 'Combat has already had enough successful beats.',
      },
    }, output({
      narration: 'With the path clear, Vymeson leads the party into a vast cavern where hidden mysteries wait.',
      choices: [
        { label: 'Examine the arcane symbols for clues', difficulty: 'normal', stat: 'magic', difficultyValue: 12 },
        { label: 'Call on nature to sense hidden dangers', difficulty: 'easy', stat: 'magic', difficultyValue: 9 },
        { label: 'Search for hidden pathways deeper into the cavern', difficulty: 'normal', stat: 'mischief', difficultyValue: 11 },
      ],
    }));

    expect(result.success).toBe(true);
  });
});
