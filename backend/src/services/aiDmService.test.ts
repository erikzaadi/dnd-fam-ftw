import { describe, it, expect, beforeEach } from 'vitest';
import { toNarrationInput } from './aiDmService.js';
import type { AIInput, EncounterSeed } from '../types.js';
import { clearSessionPromptCacheForTest } from '../lib/sessionPromptCache.js';

const makeAIInput = (overrides: Partial<AIInput> = {}): AIInput => ({
  id: 'session-1',
  scene: 'A goblin kitchen',
  sceneId: 'kitchen-1',
  turn: 2,
  party: [
    {
      id: 'hero-1',
      name: 'Pip',
      class: 'Rogue',
      species: 'Halfling',
      quirk: 'Always hungry',
      hp: 8,
      max_hp: 10,
      status: 'active',
      stats: { might: 1, magic: 2, mischief: 4 },
      inventory: [],
    },
    {
      id: 'hero-2',
      name: 'Zara',
      class: 'Wizard',
      species: 'Elf',
      quirk: 'Talks to books',
      hp: 10,
      max_hp: 10,
      status: 'active',
      stats: { might: 1, magic: 5, mischief: 2 },
      inventory: [],
    },
  ],
  activeCharacterId: 'hero-2',
  characterId: 'hero-1',
  npcs: [],
  quests: [],
  lastChoices: [],
  tone: 'comedic',
  recentHistory: ['The goblin chef threw a ladle at Pip.'],
  displayName: 'Test World',
  difficulty: 'normal',
  gameMode: 'balanced',
  savingsMode: false,
  interventionState: { rescuesUsed: 0 },
  storySummary: '',
  actionAttempt: 'Sneak past the chef',
  actionResult: { success: true, roll: 14, statUsed: 'mischief' },
  ...overrides,
});

beforeEach(() => {
  clearSessionPromptCacheForTest();
});

describe('toNarrationInput', () => {
  it('separates actingCharacterName and nextCharacterName', () => {
    const out = toNarrationInput(makeAIInput());
    expect(out.actingCharacterName).toBe('Pip');
    expect(out.nextCharacterName).toBe('Zara');
  });

  it('passes gameMode through', () => {
    const out = toNarrationInput(makeAIInput({ gameMode: 'fast' }));
    expect(out.gameMode).toBe('fast');
  });

  it('passes active party status through', () => {
    const out = toNarrationInput(makeAIInput());
    expect(out.party[0].status).toBe('active');
  });

  it('passes party species through', () => {
    const out = toNarrationInput(makeAIInput());
    expect(out.party[0].species).toBe('Halfling');
    expect(out.party[1].species).toBe('Elf');
  });

  it('passes party stats through for character-specific choice generation', () => {
    const out = toNarrationInput(makeAIInput());
    expect(out.party[0].stats).toEqual({ might: 1, magic: 2, mischief: 4 });
    expect(out.party[1].stats).toEqual({ might: 1, magic: 5, mischief: 2 });
  });

  it('passes downed status through', () => {
    const out = toNarrationInput(makeAIInput({
      party: [{ ...makeAIInput().party[0], status: 'downed', hp: 0 }],
    }));
    expect(out.party[0].status).toBe('downed');
  });

  it('inventory items include ownerName and healValue', () => {
    const potion = { id: 'p1', name: 'Healing Potion', description: 'Heals 3 HP', healValue: 3, consumable: true, transferable: false };
    const out = toNarrationInput(makeAIInput({
      party: [{ ...makeAIInput().party[0], inventory: [potion] }],
    }));
    expect(out.inventory).toHaveLength(1);
    expect(out.inventory[0].ownerName).toBe('Pip');
    expect(out.inventory[0].healValue).toBe(3);
    expect(out.inventory[0].consumable).toBe(true);
  });

  it('flattens multi-character inventory with correct owners', () => {
    const potion = { id: 'p1', name: 'Healing Potion', description: 'Heals 3 HP', healValue: 3, consumable: true, transferable: false };
    const sword = { id: 's1', name: 'Magic Blade', description: 'Glows', transferable: true, consumable: false };
    const out = toNarrationInput(makeAIInput({
      party: [
        { ...makeAIInput().party[0], inventory: [potion] },
        { id: 'hero-2', name: 'Zara', class: 'Wizard', species: 'Elf', quirk: 'Talks to books', hp: 6, max_hp: 10, status: 'active', stats: { might: 1, magic: 5, mischief: 2 }, inventory: [sword] },
      ],
    }));
    expect(out.inventory).toHaveLength(2);
    expect(out.inventory.find(i => i.ownerName === 'Pip')).toBeDefined();
    expect(out.inventory.find(i => i.ownerName === 'Zara')?.transferable).toBe(true);
  });

  it('passes non-empty storySummary through', () => {
    const out = toNarrationInput(makeAIInput({ storySummary: 'The party upset the chef.' }));
    expect(out.storySummary).toBe('The party upset the chef.');
  });

  it('converts empty storySummary to undefined', () => {
    const out = toNarrationInput(makeAIInput({ storySummary: '' }));
    expect(out.storySummary).toBeUndefined();
  });

  it('isFirstTurn is true at turn 1', () => {
    expect(toNarrationInput(makeAIInput({ turn: 1 })).isFirstTurn).toBe(true);
  });

  it('isFirstTurn is false after turn 1', () => {
    expect(toNarrationInput(makeAIInput({ turn: 3 })).isFirstTurn).toBe(false);
  });

  it('passes recentHistory through', () => {
    const out = toNarrationInput(makeAIInput({ recentHistory: ['Turn 1.', 'Turn 2.'] }));
    expect(out.recentHistory).toHaveLength(2);
    expect(out.recentHistory[0]).toBe('Turn 1.');
  });

  it('passes structured scenePressure through', () => {
    const out = toNarrationInput(makeAIInput({
      scenePressure: {
        kind: 'combat',
        pressureTurns: 2,
        successfulPressureTurns: 1,
        previousTensionLevels: ['high'],
        reason: 'Scene pressure computed.',
      },
    }));

    expect(out.scenePressure).toEqual({
      kind: 'combat',
      pressureTurns: 2,
      successfulPressureTurns: 1,
      previousTensionLevels: ['high'],
      reason: 'Scene pressure computed.',
    });
  });

  it('passes structured sceneMomentum through', () => {
    const out = toNarrationInput(makeAIInput({
      sceneMomentum: {
        directive: 'victory_exit',
        staleChoiceCount: 1,
        turnsSinceSceneChange: 2,
        turnsSinceCombat: 1,
        justCompletedCombat: true,
        justCompletedDifficultChallenge: false,
        suggestedNextBeat: 'Move into the next chamber.',
        reason: 'Deterministic momentum.',
      },
    }));

    expect(out.sceneMomentum).toEqual({
      directive: 'victory_exit',
      staleChoiceCount: 1,
      turnsSinceSceneChange: 2,
      turnsSinceCombat: 1,
      justCompletedCombat: true,
      justCompletedDifficultChallenge: false,
      suggestedNextBeat: 'Move into the next chamber.',
      reason: 'Deterministic momentum.',
    });
  });

  it('summarizes previous choice flavor patterns', () => {
    const out = toNarrationInput(makeAIInput({
      actionAttempt: 'Sprint across the falling stones',
      lastChoices: [
        { label: 'Sprint across the falling stones', difficulty: 'normal', stat: 'might', difficultyValue: 11, flavor: 'environment', environmentFeature: 'falling bridge stones' },
        { label: 'Ask Zara for a timing spell', difficulty: 'easy', stat: 'magic', difficultyValue: 8, flavor: 'combo', helperCharacterName: 'Zara' },
        { label: 'Take the careful path', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, flavor: 'environment', environmentFeature: 'falling bridge stones' },
      ],
    }));

    expect(out.previousChoiceFlavors).toEqual(['environment', 'combo']);
    expect(out.previousChoiceLabels).toEqual([
      'Sprint across the falling stones',
      'Ask Zara for a timing spell',
      'Take the careful path',
    ]);
    expect(out.selectedChoiceFlavor).toBe('environment');
    expect(out.selectedEnvironmentFeature).toBe('falling bridge stones');
  });

  it('statUsed "none" becomes undefined', () => {
    const out = toNarrationInput(makeAIInput({ actionResult: { success: true, roll: 0, statUsed: 'none' } }));
    expect(out.actionResult.statUsed).toBeUndefined();
  });

  it('failed action has correct summary', () => {
    const out = toNarrationInput(makeAIInput({ actionResult: { success: false, roll: 3, statUsed: 'might' } }));
    expect(out.actionResult.summary).toBe('The action failed.');
  });

  it('passes impact through for rolled actions and includes it in summary', () => {
    const out = toNarrationInput(makeAIInput({ actionResult: { success: true, roll: 19, statUsed: 'might', statBonus: 4, itemBonus: 2, helperBonus: 2, helperCharacterName: 'Zara', choiceItemBonus: 2, choiceItemName: 'Moon Key', choiceItemOwnerName: 'Pip', characterBonus: 2, characterBonusLabel: 'spotlight', difficultyTarget: 14, impact: 'strong' } }));
    expect(out.actionResult.impact).toBe('strong');
    expect(out.actionResult.statBonus).toBe(4);
    expect(out.actionResult.itemBonus).toBe(2);
    expect(out.actionResult.helperBonus).toBe(2);
    expect(out.actionResult.helperCharacterName).toBe('Zara');
    expect(out.actionResult.choiceItemBonus).toBe(2);
    expect(out.actionResult.choiceItemName).toBe('Moon Key');
    expect(out.actionResult.choiceItemOwnerName).toBe('Pip');
    expect(out.actionResult.characterBonus).toBe(2);
    expect(out.actionResult.characterBonusLabel).toBe('spotlight');
    expect(out.actionResult.total).toBe(31);
    expect(out.actionResult.margin).toBe(17);
    expect(out.actionResult.difficultyTarget).toBe(14);
    expect(out.actionResult.summary).toBe('The action succeeded with strong impact.');
  });

  it('passes active buffs and buff roll bonuses through', () => {
    const out = toNarrationInput(makeAIInput({
      party: [{
        ...makeAIInput().party[0],
        buffs: [{ id: 'bless', name: 'Blessed', description: 'A bright charm.', statBonuses: { mischief: 1 }, remainingTurns: 2 }],
      }],
      actionResult: { success: true, roll: 10, statUsed: 'mischief', statBonus: 4, buffBonus: 1, buffBonusLabel: 'Blessed', difficultyTarget: 14 },
    }));

    expect(out.party[0].buffs?.[0].name).toBe('Blessed');
    expect(out.actionResult.buffBonus).toBe(1);
    expect(out.actionResult.buffBonusLabel).toBe('Blessed');
    expect(out.actionResult.total).toBe(15);
    expect(out.actionResult.margin).toBe(1);
  });

  it('passes a high total and positive margin when a low die succeeds through bonuses', () => {
    const out = toNarrationInput(makeAIInput({
      actionResult: {
        success: true,
        roll: 4,
        statUsed: 'magic',
        statBonus: 4,
        itemBonus: 11,
        difficultyTarget: 8,
        impact: 'strong',
      },
    }));

    expect(out.actionResult.total).toBe(19);
    expect(out.actionResult.margin).toBe(11);
    expect(out.actionResult.summary).toBe('The action succeeded with strong impact.');
  });

  it('passes sanctuaryRecovery flag through', () => {
    const out = toNarrationInput({ ...makeAIInput(), sanctuaryRecovery: true });
    expect(out.sanctuaryRecovery).toBe(true);
  });

  it('passes interventionRescue flag through', () => {
    const out = toNarrationInput({ ...makeAIInput(), interventionRescue: true });
    expect(out.interventionRescue).toBe(true);
  });

  it('actingCharacterName is undefined when characterId does not match any party member', () => {
    const out = toNarrationInput(makeAIInput({ characterId: 'no-such-id' }));
    expect(out.actingCharacterName).toBeUndefined();
  });

  it('nextCharacterName is undefined when activeCharacterId does not match any party member', () => {
    const out = toNarrationInput(makeAIInput({ activeCharacterId: 'no-such-id' }));
    expect(out.nextCharacterName).toBeUndefined();
  });

  it('difficulty is undefined in actionResult when acting character is not found', () => {
    const out = toNarrationInput(makeAIInput({ characterId: 'no-such-id' }));
    expect(out.actionResult.difficulty).toBeUndefined();
  });

  it('difficulty is set in actionResult when acting character is found', () => {
    const out = toNarrationInput(makeAIInput({ characterId: 'hero-1' }));
    expect(out.actionResult.difficulty).toBe('normal');
  });

  it('empty party produces empty party and inventory arrays', () => {
    const out = toNarrationInput(makeAIInput({ party: [], characterId: '', activeCharacterId: '' }));
    expect(out.party).toHaveLength(0);
    expect(out.inventory).toHaveLength(0);
  });

  it('dmPrep is included when set', () => {
    const out = toNarrationInput(makeAIInput({ dmPrep: 'The villain is a dragon named Zyx.' }));
    expect(out.dmPrep).toBe('The villain is a dragon named Zyx.');
  });

  it('dmPrep is omitted when not set', () => {
    const out = toNarrationInput(makeAIInput({ dmPrep: undefined }));
    expect('dmPrep' in out).toBe(false);
  });

  it('passes prepared encounter seeds into narration when available', () => {
    const dmPrepEncounters: EncounterSeed[] = [
      {
        name: 'Kitchen Knife Chorus',
        triggerHint: 'When the goblin kitchen erupts into a clattering alarm.',
        enemies: [
          {
            name: 'Cleaver Goblin',
            role: 'standard',
            weaknesses: [
              { label: 'grease slick', school: 'mechanical' as const },
            ],
          },
        ],
        areas: [{ label: 'Greasy prep table', tags: ['slick', 'kitchen'] }],
        objective: 'Drive the knife-wielding cooks away.',
        lootHint: 'a moon-stamped pantry key',
      },
    ];

    const out = toNarrationInput(makeAIInput({ dmPrepEncounters }));
    expect(out.dmPrepEncounters).toEqual(dmPrepEncounters);
  });

  it('omits prepared encounter seeds when none are available', () => {
    const out = toNarrationInput(makeAIInput({ dmPrepEncounters: [] }));
    expect('dmPrepEncounters' in out).toBe(false);
  });

  it('character history is included in party entry when set', () => {
    const charWithHistory = { ...makeAIInput().party[0], history: 'Survived the goblin war.' };
    const out = toNarrationInput(makeAIInput({ party: [charWithHistory] }));
    expect(out.party[0].history).toBe('Survived the goblin war.');
  });

  it('character history is omitted from party entry when not set', () => {
    const out = toNarrationInput(makeAIInput());
    expect('history' in out.party[0]).toBe(false);
  });

  it('omits dmPrep during active encounter', () => {
    const out = toNarrationInput(makeAIInput({
      dmPrep: 'The villain is a dragon named Zyx.',
      encounterState: { id: 'enc-1', name: 'Goblin Fight', status: 'active', enemies: [], areas: [], round: 1 },
    }));
    expect('dmPrep' in out).toBe(false);
  });

  it('caps dmPrep at 3000 chars on non-encounter turns', () => {
    const longPrep = 'A'.repeat(5000);
    const out = toNarrationInput(makeAIInput({ dmPrep: longPrep }));
    expect(out.dmPrep?.length).toBe(3000);
  });

  it('caps long dmPrep at 3000 chars synchronously with no async enrichment', () => {
    // toNarrationInput is synchronous - long prep is truncated by slice, never enriched
    const longPrep = 'B'.repeat(8000);
    const out = toNarrationInput(makeAIInput({ dmPrep: longPrep }));
    expect(out.dmPrep?.length).toBe(3000);
    expect(out.dmPrep).toBe(longPrep.slice(0, 3000));
  });

  it('keeps dmPrep under 3000 chars unchanged on non-encounter turns', () => {
    const shortPrep = 'Short campaign prep.';
    const out = toNarrationInput(makeAIInput({ dmPrep: shortPrep }));
    expect(out.dmPrep).toBe(shortPrep);
  });

  it('omits dmPrepEncounters during active encounter', () => {
    const dmPrepEncounters: EncounterSeed[] = [
      { name: 'Test Fight', triggerHint: 'When battle begins.', enemies: [{ name: 'Foe', role: 'standard', weaknesses: [] }], areas: [], objective: 'Win.' },
    ];
    const out = toNarrationInput(makeAIInput({
      dmPrepEncounters,
      encounterState: { id: 'enc-1', name: 'Test Fight', status: 'active', enemies: [], areas: [], round: 1 },
    }));
    expect('dmPrepEncounters' in out).toBe(false);
  });

  it('caps character history at 200 chars', () => {
    const longHistory = 'B'.repeat(300);
    const charWithHistory = { ...makeAIInput().party[0], history: longHistory };
    const out = toNarrationInput(makeAIInput({ party: [charWithHistory] }));
    expect(out.party[0].history?.length).toBe(200);
  });

  it('caps item description at 200 chars', () => {
    const longDesc = 'C'.repeat(300);
    const item = { id: 'i1', name: 'Big Item', description: longDesc, consumable: false, transferable: true };
    const out = toNarrationInput(makeAIInput({
      party: [{ ...makeAIInput().party[0], inventory: [item] }],
    }));
    expect(out.inventory[0].description.length).toBe(200);
  });

  it('omits item effect when over 150 chars', () => {
    const longEffect = 'D'.repeat(200);
    const item = { id: 'i1', name: 'Item', description: 'desc', effect: longEffect, consumable: false, transferable: true };
    const out = toNarrationInput(makeAIInput({
      party: [{ ...makeAIInput().party[0], inventory: [item] }],
    }));
    expect(out.inventory[0].effect).toBeUndefined();
  });

  it('keeps item effect when 150 chars or under', () => {
    const shortEffect = 'E'.repeat(150);
    const item = { id: 'i1', name: 'Item', description: 'desc', effect: shortEffect, consumable: false, transferable: true };
    const out = toNarrationInput(makeAIInput({
      party: [{ ...makeAIInput().party[0], inventory: [item] }],
    }));
    expect(out.inventory[0].effect).toBe(shortEffect);
  });

  it('keeps encounterLootHint when active encounter matches a seed', () => {
    const dmPrepEncounters: EncounterSeed[] = [
      { name: 'Kitchen Knife Chorus', triggerHint: 'When...', enemies: [{ name: 'Cleaver Goblin', role: 'standard', weaknesses: [] }], areas: [], objective: 'Drive them off.', lootHint: 'a moon-stamped pantry key' },
    ];
    const out = toNarrationInput(makeAIInput({
      dmPrepEncounters,
      encounterState: { id: 'enc-1', name: 'Kitchen Knife Chorus', status: 'active', enemies: [], areas: [], round: 1 },
    }));
    // lootHint should still be available even though dmPrepEncounters are omitted from narration input
    expect(out.encounterLootHint).toBe('a moon-stamped pantry key');
  });

  describe('prompt cache integration', () => {
    it('produces identical stable fields on second call (cache hit)', () => {
      const first = toNarrationInput(makeAIInput());
      const second = toNarrationInput(makeAIInput());
      expect(second.party[0].class).toBe(first.party[0].class);
      expect(second.party[0].species).toBe(first.party[0].species);
      expect(second.party[0].stats).toEqual(first.party[0].stats);
      expect(second.inventory).toEqual(first.inventory);
    });

    it('reflects volatile HP change even when stable fields are cached', () => {
      toNarrationInput(makeAIInput()); // prime cache
      const input = makeAIInput();
      input.party[0] = { ...input.party[0], hp: 3 }; // only HP changes (volatile)
      const out = toNarrationInput(input);
      expect(out.party[0].hp).toBe(3);
      expect(out.party[0].class).toBe('Rogue'); // stable field still present
    });

    it('reflects volatile downed status change even when stable fields are cached', () => {
      toNarrationInput(makeAIInput()); // prime cache
      const input = makeAIInput();
      input.party[0] = { ...input.party[0], hp: 0, status: 'downed' };
      const out = toNarrationInput(input);
      expect(out.party[0].status).toBe('downed');
      expect(out.party[0].maxHp).toBe(10); // stable field still present
    });

    it('rebuilds stable party when stats change (version mismatch)', () => {
      toNarrationInput(makeAIInput()); // prime cache
      const input = makeAIInput();
      input.party[0] = { ...input.party[0], stats: { might: 5, magic: 2, mischief: 4 } };
      const out = toNarrationInput(input);
      expect(out.party[0].stats.might).toBe(5);
    });

    it('rebuilds inventory when item is added (version mismatch)', () => {
      toNarrationInput(makeAIInput()); // prime cache - no inventory
      const item = { id: 'i1', name: '🗡️ Dagger', description: 'Sharp.', consumable: false, transferable: true };
      const input = makeAIInput();
      input.party[0] = { ...input.party[0], inventory: [item] };
      const out = toNarrationInput(input);
      expect(out.inventory).toHaveLength(1);
      expect(out.inventory[0].name).toBe('🗡️ Dagger');
    });
  });
});
