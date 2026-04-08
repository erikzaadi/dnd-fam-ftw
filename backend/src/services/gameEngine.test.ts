import { GameEngine } from './gameEngine.js';
import { Character, SessionState } from '../types.js';

const mockCharacter: Character = {
  id: 'hero-1',
  name: 'Barnaby',
  class: 'Mage',
  species: 'Human',
  quirk: 'Afraid of butterflies',
  hp: 10,
  max_hp: 10,
  stats: { might: 1, magic: 2, mischief: 3 },
  inventory: []
};

const mockSession: SessionState = {
  id: 'session-1',
  scene: 'A Dark Cave',
  sceneId: 'cave-1',
  turn: 1,
  party: [mockCharacter],
  activeCharacterId: 'hero-1',
  npcs: [],
  quests: [],
  lastChoices: [
    { label: 'Attack the goblin', difficulty: 'normal', stat: 'might' }
  ],
  tone: "thrilling",
  recentHistory: [],
  displayName: "Test World",
  difficulty: "normal",
  savingsMode: false
  };
console.log("Testing GameEngine...");

// Test 1: Resolve Action
console.log("Test 1: Resolving action...");
const attempt = GameEngine.resolveAction(mockCharacter, 'Attack the goblin', 'might', 'normal');
console.log(`- Result: ${attempt.actionResult.success ? 'Success' : 'Failure'} (Roll: ${attempt.actionResult.roll})`);

// Test 2: Update State (Failure should deal damage)
console.log("Test 2: Updating state on failure...");
const failedAttempt = {
  actionAttempt: 'Attack the goblin',
  actionResult: { success: false, roll: 5, statUsed: 'might' as const }
};

const newState = GameEngine.updateState(mockSession, failedAttempt, { 
    choices: [{ label: 'Run away', difficulty: 'easy', stat: 'mischief' }] 
});

console.log(`- Turn increased to: ${newState.turn}`);
console.log(`- Hero HP: ${newState.party[0].hp} / ${mockCharacter.hp}`);
console.log(`- Next choices updated: ${newState.lastChoices[0].label}`);

if (newState.turn !== 2) {throw new Error("Turn should be 2");}
if (newState.party[0].hp >= mockCharacter.hp) {throw new Error("HP should have decreased on failure");}
if (newState.lastChoices[0].label !== 'Run away') {throw new Error("Last choices not updated");}

// Test 3: Inventory item is added when AI suggests one
console.log("Test 3: Inventory item added on suggested loot...");
const lootAttempt = { actionAttempt: 'Search the chest', actionResult: { success: true, roll: 15, statUsed: 'mischief' as const } };
const sword = { name: 'Rusty Sword', description: 'A well-worn blade, still sharp enough.' };
const lootState = GameEngine.updateState(mockSession, lootAttempt, { suggestedInventoryAdd: sword });
if (lootState.party[0].inventory.length !== 1) { throw new Error("Inventory should have 1 item"); }
if (lootState.party[0].inventory[0].name !== 'Rusty Sword') { throw new Error("Item name mismatch"); }
console.log(`- Added: "${lootState.party[0].inventory[0].name}" — ${lootState.party[0].inventory[0].description}`);

// Test 4: null suggestedInventoryAdd does NOT pollute inventory
console.log("Test 4: null suggestedInventoryAdd leaves inventory empty...");
const noLootState = GameEngine.updateState(mockSession, lootAttempt, { suggestedInventoryAdd: null });
if (noLootState.party[0].inventory.length !== 0) { throw new Error("Inventory should remain empty when suggestedInventoryAdd is null"); }
console.log("- Inventory correctly empty.");

// Test 5: undefined suggestedInventoryAdd leaves inventory empty
console.log("Test 5: missing suggestedInventoryAdd leaves inventory empty...");
const noSuggestState = GameEngine.updateState(mockSession, lootAttempt, {});
if (noSuggestState.party[0].inventory.length !== 0) { throw new Error("Inventory should remain empty when suggestedInventoryAdd is missing"); }
console.log("- Inventory correctly empty.");

// Test 6: Items accumulate across turns (original session state is not mutated)
console.log("Test 6: Multiple items accumulate without mutating original session...");
const shield = { name: 'Cracked Shield', description: 'Better than nothing.' };
const afterSword = GameEngine.updateState(mockSession, lootAttempt, { suggestedInventoryAdd: sword });
// Use afterSword as base for next turn — need a session with the sword already in inventory
const sessionWithSword = { ...mockSession, party: afterSword.party };
const afterShield = GameEngine.updateState(sessionWithSword, lootAttempt, { suggestedInventoryAdd: shield });
if (afterShield.party[0].inventory.length !== 2) { throw new Error(`Expected 2 items, got ${afterShield.party[0].inventory.length}`); }
if (mockSession.party[0].inventory.length !== 0) { throw new Error("Original session should not be mutated"); }
console.log(`- Inventory has ${afterShield.party[0].inventory.length} items: ${afterShield.party[0].inventory.map(i => i.name).join(', ')}`);

// Test 7: Array as suggestedInventoryAdd is ignored (not pushed raw)
console.log("Test 7: Array suggestedInventoryAdd is ignored...");
const arrayLootState = GameEngine.updateState(mockSession, lootAttempt, { suggestedInventoryAdd: [sword] as unknown as typeof sword });
if (arrayLootState.party[0].inventory.length !== 0) { throw new Error("Array should not be pushed as inventory item"); }
console.log("- Array correctly ignored.");

console.log("All tests passed!");
