import { toNarrationInput } from './aiDmService.js';
import { StorySummaryService } from './storySummaryService.js';
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
    }
  ],
  activeCharacterId: 'hero-1',
  npcs: [],
  quests: [],
  lastChoices: [],
  tone: 'comedic',
  recentHistory: ['The goblin chef threw a ladle at Pip.'],
  displayName: 'Test World',
  difficulty: 'normal',
  savingsMode: false,
  useLocalAI: false,
  interventionState: { used: false },
  storySummary: '',
  actionAttempt: 'Sneak past the chef',
  actionResult: { success: true, roll: 14, statUsed: 'mischief' },
  ...overrides,
});

console.log('Testing toNarrationInput mapping...');

// Test 1: party status is mapped correctly
console.log('Test 1: party status is passed through...');
const input1 = makeAIInput();
const out1 = toNarrationInput(input1);
if (out1.party[0].status !== 'active') throw new Error(`Expected 'active', got '${out1.party[0].status}'`);
console.log('- status: active ✓');

// Test 2: downed status is mapped
console.log('Test 2: downed status is mapped...');
const input2 = makeAIInput({
  party: [{ ...makeAIInput().party[0], status: 'downed', hp: 0 }]
});
const out2 = toNarrationInput(input2);
if (out2.party[0].status !== 'downed') throw new Error(`Expected 'downed', got '${out2.party[0].status}'`);
console.log('- status: downed ✓');

// Test 3: ownerName on inventory items
console.log('Test 3: inventory items include ownerName...');
const potion = { id: 'p1', name: 'Healing Potion', description: 'Heals 3 HP', healValue: 3, consumable: true, transferable: false };
const input3 = makeAIInput({
  party: [{ ...makeAIInput().party[0], inventory: [potion] }]
});
const out3 = toNarrationInput(input3);
if (out3.inventory.length !== 1) throw new Error('Expected 1 inventory item');
if (out3.inventory[0].ownerName !== 'Pip') throw new Error(`Expected ownerName 'Pip', got '${out3.inventory[0].ownerName}'`);
if (out3.inventory[0].healValue !== 3) throw new Error(`Expected healValue 3, got ${out3.inventory[0].healValue}`);
if (out3.inventory[0].consumable !== true) throw new Error('Expected consumable true');
console.log(`- ownerName: '${out3.inventory[0].ownerName}', healValue: ${out3.inventory[0].healValue} ✓`);

// Test 4: inventory items from multiple characters are all included with correct owners
console.log('Test 4: multi-character inventory all included with correct owners...');
const sword = { id: 's1', name: 'Magic Blade', description: 'Glows', transferable: true, consumable: false };
const input4 = makeAIInput({
  party: [
    { ...makeAIInput().party[0], inventory: [potion] },
    { id: 'hero-2', name: 'Zara', class: 'Wizard', species: 'Elf', quirk: 'Talks to books', hp: 6, max_hp: 10, status: 'active', stats: { might: 1, magic: 5, mischief: 2 }, inventory: [sword] },
  ]
});
const out4 = toNarrationInput(input4);
if (out4.inventory.length !== 2) throw new Error(`Expected 2 items, got ${out4.inventory.length}`);
const pipItem = out4.inventory.find(i => i.ownerName === 'Pip');
const zaraItem = out4.inventory.find(i => i.ownerName === 'Zara');
if (!pipItem) throw new Error('Missing Pip item');
if (!zaraItem) throw new Error('Missing Zara item');
if (zaraItem.transferable !== true) throw new Error('Expected transferable true for Zara item');
console.log(`- Pip has '${pipItem.name}', Zara has '${zaraItem.name}' ✓`);

// Test 5: storySummary is passed when non-empty
console.log('Test 5: storySummary passed when set...');
const input5 = makeAIInput({ storySummary: 'The party entered the goblin lair and upset the chef.' });
const out5 = toNarrationInput(input5);
if (out5.storySummary !== 'The party entered the goblin lair and upset the chef.') throw new Error('storySummary not passed');
console.log(`- storySummary: '${out5.storySummary?.slice(0, 40)}...' ✓`);

// Test 6: empty storySummary becomes undefined (not sent to AI)
console.log('Test 6: empty storySummary becomes undefined...');
const out6 = toNarrationInput(makeAIInput({ storySummary: '' }));
if (out6.storySummary !== undefined) throw new Error(`Expected undefined, got '${out6.storySummary}'`);
console.log('- storySummary: undefined ✓');

// Test 7: isFirstTurn true at turn 1
console.log('Test 7: isFirstTurn true at turn 1...');
const out7 = toNarrationInput(makeAIInput({ turn: 1 }));
if (!out7.isFirstTurn) throw new Error('Expected isFirstTurn true');
console.log('- isFirstTurn: true ✓');

// Test 8: isFirstTurn false after turn 1
console.log('Test 8: isFirstTurn false after turn 1...');
const out8 = toNarrationInput(makeAIInput({ turn: 3 }));
if (out8.isFirstTurn) throw new Error('Expected isFirstTurn false');
console.log('- isFirstTurn: false ✓');

// Test 9: recentHistory is passed through
console.log('Test 9: recentHistory is passed through...');
const history = ['Turn 1 narration.', 'Turn 2 narration.'];
const out9 = toNarrationInput(makeAIInput({ recentHistory: history }));
if (out9.recentHistory.length !== 2) throw new Error(`Expected 2 history entries, got ${out9.recentHistory.length}`);
if (out9.recentHistory[0] !== 'Turn 1 narration.') throw new Error('recentHistory[0] mismatch');
console.log(`- recentHistory: ${out9.recentHistory.length} entries ✓`);

// Test 10: statUsed 'none' becomes undefined in narration input
console.log('Test 10: statUsed none becomes undefined...');
const out10 = toNarrationInput(makeAIInput({ actionResult: { success: true, roll: 0, statUsed: 'none' } }));
if (out10.actionResult.statUsed !== undefined) throw new Error(`Expected undefined, got '${out10.actionResult.statUsed}'`);
console.log('- statUsed: undefined ✓');

// Test 11: failed action has correct summary
console.log('Test 11: failed action summary...');
const out11 = toNarrationInput(makeAIInput({ actionResult: { success: false, roll: 3, statUsed: 'might' } }));
if (out11.actionResult.summary !== 'The action failed.') throw new Error(`Unexpected summary: '${out11.actionResult.summary}'`);
console.log('- summary: "The action failed." ✓');

// ── StorySummaryService.shouldUpdate ────────────────────────────────────────
console.log('\nTesting StorySummaryService.shouldUpdate...');

// Test 12: never update at turn 1
console.log('Test 12: shouldUpdate false at turn 1...');
if (StorySummaryService.shouldUpdate(1)) throw new Error('Should not update at turn 1');
console.log('- turn 1: false ✓');

// Test 13: no update before interval
console.log('Test 13: shouldUpdate false at turns 2-4...');
for (const t of [2, 3, 4]) {
  if (StorySummaryService.shouldUpdate(t)) throw new Error(`Should not update at turn ${t}`);
}
console.log('- turns 2-4: false ✓');

// Test 14: update at turn 5
console.log('Test 14: shouldUpdate true at turn 5...');
if (!StorySummaryService.shouldUpdate(5)) throw new Error('Should update at turn 5');
console.log('- turn 5: true ✓');

// Test 15: update at subsequent multiples
console.log('Test 15: shouldUpdate true at turns 10, 15, 20...');
for (const t of [10, 15, 20]) {
  if (!StorySummaryService.shouldUpdate(t)) throw new Error(`Should update at turn ${t}`);
}
console.log('- turns 10, 15, 20: true ✓');

// Test 16: no update between multiples
console.log('Test 16: shouldUpdate false between multiples...');
for (const t of [6, 7, 8, 9, 11, 13]) {
  if (StorySummaryService.shouldUpdate(t)) throw new Error(`Should not update at turn ${t}`);
}
console.log('- turns 6-9, 11, 13: false ✓');

// Test 17: sanctuaryRecovery flag is passed through
console.log('Test 17: sanctuaryRecovery flag passed through...');
const out17 = toNarrationInput({ ...makeAIInput(), sanctuaryRecovery: true });
if (!out17.sanctuaryRecovery) throw new Error('Expected sanctuaryRecovery true');
console.log('- sanctuaryRecovery: true ✓');

// Test 18: interventionRescue flag is passed through
console.log('Test 18: interventionRescue flag passed through...');
const out18 = toNarrationInput({ ...makeAIInput(), interventionRescue: true });
if (!out18.interventionRescue) throw new Error('Expected interventionRescue true');
console.log('- interventionRescue: true ✓');

console.log('\nAll aiDmService + StorySummaryService tests passed!');
