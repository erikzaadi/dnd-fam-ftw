import { describe, it, expect } from 'vitest';
import { toNarrationInput } from './aiDmService.js';
import type { AIInput } from '../types.js';

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
  useLocalAI: false,
  interventionState: { rescuesUsed: 0 },
  storySummary: '',
  actionAttempt: 'Sneak past the chef',
  actionResult: { success: true, roll: 14, statUsed: 'mischief' },
  ...overrides,
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

  it('statUsed "none" becomes undefined', () => {
    const out = toNarrationInput(makeAIInput({ actionResult: { success: true, roll: 0, statUsed: 'none' } }));
    expect(out.actionResult.statUsed).toBeUndefined();
  });

  it('failed action has correct summary', () => {
    const out = toNarrationInput(makeAIInput({ actionResult: { success: false, roll: 3, statUsed: 'might' } }));
    expect(out.actionResult.summary).toBe('The action failed.');
  });

  it('passes impact through for rolled actions and includes it in summary', () => {
    const out = toNarrationInput(makeAIInput({ actionResult: { success: true, roll: 19, statUsed: 'might', statBonus: 4, itemBonus: 2, difficultyTarget: 14, impact: 'strong' } }));
    expect(out.actionResult.impact).toBe('strong');
    expect(out.actionResult.statBonus).toBe(4);
    expect(out.actionResult.itemBonus).toBe(2);
    expect(out.actionResult.total).toBe(25);
    expect(out.actionResult.margin).toBe(11);
    expect(out.actionResult.difficultyTarget).toBe(14);
    expect(out.actionResult.summary).toBe('The action succeeded with strong impact.');
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

  it('character history is included in party entry when set', () => {
    const charWithHistory = { ...makeAIInput().party[0], history: 'Survived the goblin war.' };
    const out = toNarrationInput(makeAIInput({ party: [charWithHistory] }));
    expect(out.party[0].history).toBe('Survived the goblin war.');
  });

  it('character history is omitted from party entry when not set', () => {
    const out = toNarrationInput(makeAIInput());
    expect('history' in out.party[0]).toBe(false);
  });
});
