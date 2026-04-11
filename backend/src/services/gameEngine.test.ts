import { GameEngine } from './gameEngine.js';
import { Character, SessionState } from '../types.js';

const makeChar = (overrides: Partial<Character> = {}): Character => ({
  id: 'hero-1',
  name: 'Barnaby',
  class: 'Mage',
  species: 'Human',
  quirk: 'Afraid of butterflies',
  hp: 10,
  max_hp: 10,
  status: 'active',
  stats: { might: 1, magic: 2, mischief: 3 },
  inventory: [],
  ...overrides,
});

const makeSession = (overrides: Partial<SessionState> = {}): SessionState => ({
  id: 'session-1',
  scene: 'A Dark Cave',
  sceneId: 'cave-1',
  turn: 1,
  party: [makeChar()],
  activeCharacterId: 'hero-1',
  npcs: [],
  quests: [],
  lastChoices: [
    { label: 'Attack the goblin', difficulty: 'normal', stat: 'might' }
  ],
  tone: 'thrilling',
  recentHistory: [],
  displayName: 'Test World',
  difficulty: 'normal',
  savingsMode: false,
  useLocalAI: false,
  ...overrides,
});

console.log("Testing GameEngine...");

// ── Original tests (updated for new types) ──────────────────────────────────

// Test 1: Resolve Action
console.log("Test 1: Resolving action...");
const attempt = GameEngine.resolveAction(makeChar(), 'Attack the goblin', 'might', 'normal');
console.log(`- Result: ${attempt.actionResult.success ? 'Success' : 'Failure'} (Roll: ${attempt.actionResult.roll})`);

// Test 2: Update State (Failure should deal damage)
console.log("Test 2: Updating state on failure...");
const session = makeSession();
const failedAttempt = {
  actionAttempt: 'Attack the goblin',
  actionResult: { success: false, roll: 5, statUsed: 'might' as const }
};
const newState = GameEngine.updateState(session, failedAttempt, {
  choices: [{ label: 'Run away', difficulty: 'easy', stat: 'mischief' }]
});
console.log(`- Turn increased to: ${newState.turn}`);
console.log(`- Hero HP: ${newState.party[0].hp} / ${makeChar().hp}`);
console.log(`- Next choices updated: ${newState.lastChoices[0].label}`);

if (newState.turn !== 2) throw new Error("Turn should be 2");
if (newState.party[0].hp >= makeChar().hp) throw new Error("HP should have decreased on failure");
if (newState.lastChoices[0].label !== 'Run away') throw new Error("Last choices not updated");

// Test 3: Inventory item is added when AI suggests one
console.log("Test 3: Inventory item added on suggested loot...");
const lootAttempt = { actionAttempt: 'Search the chest', actionResult: { success: true, roll: 15, statUsed: 'mischief' as const } };
const sword = { name: 'Rusty Sword', description: 'A well-worn blade, still sharp enough.' };
const lootState = GameEngine.updateState(session, lootAttempt, { suggestedInventoryAdd: sword });
if (lootState.party[0].inventory.length !== 1) throw new Error("Inventory should have 1 item");
if (lootState.party[0].inventory[0].name !== 'Rusty Sword') throw new Error("Item name mismatch");
if (!lootState.party[0].inventory[0].id) throw new Error("Added item should have an id");
console.log(`- Added: "${lootState.party[0].inventory[0].name}" (id: ${lootState.party[0].inventory[0].id})`);

// Test 4: null suggestedInventoryAdd does NOT pollute inventory
console.log("Test 4: null suggestedInventoryAdd leaves inventory empty...");
const noLootState = GameEngine.updateState(session, lootAttempt, { suggestedInventoryAdd: null });
if (noLootState.party[0].inventory.length !== 0) throw new Error("Inventory should remain empty when suggestedInventoryAdd is null");
console.log("- Inventory correctly empty.");

// Test 5: undefined suggestedInventoryAdd leaves inventory empty
console.log("Test 5: missing suggestedInventoryAdd leaves inventory empty...");
const noSuggestState = GameEngine.updateState(session, lootAttempt, {});
if (noSuggestState.party[0].inventory.length !== 0) throw new Error("Inventory should remain empty when suggestedInventoryAdd is missing");
console.log("- Inventory correctly empty.");

// Test 6: Items accumulate across turns (original session state is not mutated)
console.log("Test 6: Multiple items accumulate without mutating original session...");
const shield = { name: 'Cracked Shield', description: 'Better than nothing.' };
const afterSword = GameEngine.updateState(session, lootAttempt, { suggestedInventoryAdd: sword });
const sessionWithSword = { ...session, party: afterSword.party };
const afterShield = GameEngine.updateState(sessionWithSword, lootAttempt, { suggestedInventoryAdd: shield });
if (afterShield.party[0].inventory.length !== 2) throw new Error(`Expected 2 items, got ${afterShield.party[0].inventory.length}`);
if (session.party[0].inventory.length !== 0) throw new Error("Original session should not be mutated");
console.log(`- Inventory has ${afterShield.party[0].inventory.length} items: ${afterShield.party[0].inventory.map(i => i.name).join(', ')}`);

// Test 7: Array as suggestedInventoryAdd is ignored (not pushed raw)
console.log("Test 7: Array suggestedInventoryAdd is ignored...");
const arrayLootState = GameEngine.updateState(session, lootAttempt, { suggestedInventoryAdd: [sword] as unknown as typeof sword });
if (arrayLootState.party[0].inventory.length !== 0) throw new Error("Array should not be pushed as inventory item");
console.log("- Array correctly ignored.");

// ── Phase 1: Downed State ───────────────────────────────────────────────────

// Test 8: Character is downed when HP reaches 0
console.log("Test 8: Character downed at 0 HP...");
const lowHpSession = makeSession({
  party: [makeChar({ hp: 2 })],
  lastChoices: [{ label: 'Big risky attack', difficulty: 'hard', stat: 'might' }]
});
const heavyFail = { actionAttempt: 'Big risky attack', actionResult: { success: false, roll: 3, statUsed: 'might' as const } };
const downedState = GameEngine.updateState(lowHpSession, heavyFail);
const downedChar = downedState.party[0];
console.log(`- HP: ${downedChar.hp}, status: ${downedChar.status}`);
if (downedChar.hp !== 0) throw new Error(`HP should be 0, got ${downedChar.hp}`);
if (downedChar.status !== 'downed') throw new Error(`Status should be 'downed', got ${downedChar.status}`);

// Test 9: Active character at 1 HP is NOT downed
console.log("Test 9: Character at 1 HP is still active...");
const nearDeathSession = makeSession({
  party: [makeChar({ hp: 3 })],
  lastChoices: [{ label: 'Attack the goblin', difficulty: 'normal', stat: 'might' }]
});
const normalFail = { actionAttempt: 'Attack the goblin', actionResult: { success: false, roll: 5, statUsed: 'might' as const } };
const nearDeathState = GameEngine.updateState(nearDeathSession, normalFail);
const nearDeathChar = nearDeathState.party[0];
console.log(`- HP: ${nearDeathChar.hp}, status: ${nearDeathChar.status}`);
if (nearDeathChar.hp <= 0) throw new Error("HP should still be above 0");
if (nearDeathChar.status !== 'active') throw new Error("Status should still be active");

// Test 10: Turn rotation skips downed characters
console.log("Test 10: Turn rotation skips downed characters...");
const char1 = makeChar({ id: 'char-1', name: 'Alice', status: 'active' });
const char2 = makeChar({ id: 'char-2', name: 'Bob', status: 'downed' });
const char3 = makeChar({ id: 'char-3', name: 'Carol', status: 'active' });
const multiSession = makeSession({
  party: [char1, char2, char3],
  activeCharacterId: 'char-1',
  lastChoices: [{ label: 'Attack', difficulty: 'normal', stat: 'might' }]
});
const successAttempt = { actionAttempt: 'Attack', actionResult: { success: true, roll: 15, statUsed: 'might' as const } };
const rotatedState = GameEngine.updateState(multiSession, successAttempt);
console.log(`- Active after turn: ${rotatedState.activeCharacterId}`);
if (rotatedState.activeCharacterId !== 'char-3') throw new Error(`Expected char-3 (skipping downed char-2), got ${rotatedState.activeCharacterId}`);

// Test 11: Turn rotation wraps around skipping downed
console.log("Test 11: Turn rotation wraps skipping downed at start...");
const wrapSession = makeSession({
  party: [char1, char2, char3],
  activeCharacterId: 'char-3',
  lastChoices: [{ label: 'Attack', difficulty: 'normal', stat: 'might' }]
});
const wrapState = GameEngine.updateState(wrapSession, successAttempt);
console.log(`- Active after wrap: ${wrapState.activeCharacterId}`);
if (wrapState.activeCharacterId !== 'char-1') throw new Error(`Expected char-1 (wrapping past downed char-2), got ${wrapState.activeCharacterId}`);

// ── Phase 1: isPartyWiped ───────────────────────────────────────────────────

// Test 12: isPartyWiped returns false when all active
console.log("Test 12: isPartyWiped false when all active...");
const allActiveSession = makeSession({ party: [makeChar({ status: 'active' })] });
if (GameEngine.isPartyWiped(allActiveSession)) throw new Error("Should not be wiped when active");
console.log("- Correctly not wiped.");

// Test 13: isPartyWiped returns true when all downed
console.log("Test 13: isPartyWiped true when all downed...");
const allDownedSession = makeSession({ party: [makeChar({ status: 'downed' })] });
if (!GameEngine.isPartyWiped(allDownedSession)) throw new Error("Should be wiped when all downed");
console.log("- Correctly detected wipe.");

// Test 14: isPartyWiped false when mixed
console.log("Test 14: isPartyWiped false when mixed active/downed...");
const mixedSession = makeSession({ party: [makeChar({ status: 'downed' }), makeChar({ id: 'hero-2', status: 'active' })] });
if (GameEngine.isPartyWiped(mixedSession)) throw new Error("Should not be wiped when at least one active");
console.log("- Correctly not wiped with mixed party.");

// ── Phase 1: applyItemUse ───────────────────────────────────────────────────

// Test 15: Use healing potion on self restores HP
console.log("Test 15: Healing potion on self restores HP...");
const healPotion = { id: 'potion-1', name: 'Healing Potion', description: 'Restores 3 HP', healValue: 3, consumable: true, transferable: false };
const woundedChar = makeChar({ hp: 5, inventory: [healPotion] });
const healSession = makeSession({ party: [woundedChar] });
const { newState: healed, actionAttempt: healAttempt } = GameEngine.applyItemUse(healSession, 'hero-1', 'potion-1', 'hero-1');
console.log(`- HP after heal: ${healed.party[0].hp}, action: "${healAttempt.actionAttempt}"`);
if (healed.party[0].hp !== 8) throw new Error(`Expected 8 HP, got ${healed.party[0].hp}`);
if (healed.party[0].inventory.length !== 0) throw new Error("Consumable should be removed after use");
if (!healAttempt.actionAttempt.includes('healing')) throw new Error("Action should mention healing");

// Test 16: Healing doesn't exceed max_hp
console.log("Test 16: Healing capped at max_hp...");
const nearFullChar = makeChar({ hp: 9, inventory: [healPotion] });
const capSession = makeSession({ party: [nearFullChar] });
const { newState: capped } = GameEngine.applyItemUse(capSession, 'hero-1', 'potion-1', 'hero-1');
if (capped.party[0].hp !== 10) throw new Error(`HP should be capped at 10, got ${capped.party[0].hp}`);
console.log(`- HP capped at ${capped.party[0].hp} (max_hp).`);

// Test 17: Non-consumable item is NOT removed after use
console.log("Test 17: Non-consumable item stays in inventory...");
const reusableItem = { id: 'ring-1', name: 'Ring of Warmth', description: 'Passive warmth', healValue: 1, consumable: false, transferable: false };
const ringChar = makeChar({ hp: 5, inventory: [reusableItem] });
const ringSession = makeSession({ party: [ringChar] });
const { newState: ringUsed } = GameEngine.applyItemUse(ringSession, 'hero-1', 'ring-1', 'hero-1');
if (ringUsed.party[0].inventory.length !== 1) throw new Error("Non-consumable item should remain in inventory");
console.log("- Non-consumable correctly kept.");

// Test 18: Use healing potion on ally
console.log("Test 18: Healing potion on ally...");
const healer = makeChar({ id: 'healer-1', name: 'Pip', inventory: [healPotion] });
const wounded = makeChar({ id: 'wounded-1', name: 'Zara', hp: 4 });
const allyHealSession = makeSession({ party: [healer, wounded], activeCharacterId: 'healer-1' });
const { newState: allyHealed, actionAttempt: allyHealAttempt } = GameEngine.applyItemUse(allyHealSession, 'healer-1', 'potion-1', 'wounded-1');
console.log(`- Ally HP: ${allyHealed.party[1].hp}, action: "${allyHealAttempt.actionAttempt}"`);
if (allyHealed.party[1].hp !== 7) throw new Error(`Expected 7 HP for ally, got ${allyHealed.party[1].hp}`);
if (!allyHealAttempt.actionAttempt.includes('Zara')) throw new Error("Action should mention the ally's name");

// Test 19: Revive a downed character with potion
console.log("Test 19: Potion revives downed character...");
const downedTarget = makeChar({ id: 'down-1', name: 'Bard', hp: 0, status: 'downed' });
const reviver = makeChar({ id: 'rev-1', name: 'Cleric', inventory: [healPotion] });
const reviveSession = makeSession({ party: [reviver, downedTarget], activeCharacterId: 'rev-1' });
const { newState: revived, actionAttempt: reviveAttempt } = GameEngine.applyItemUse(reviveSession, 'rev-1', 'potion-1', 'down-1');
const revivedChar = revived.party[1];
console.log(`- Revived HP: ${revivedChar.hp}, status: ${revivedChar.status}, action: "${reviveAttempt.actionAttempt}"`);
if (revivedChar.hp !== 3) throw new Error(`Expected 3 HP after revive, got ${revivedChar.hp}`);
if (revivedChar.status !== 'active') throw new Error("Revived character should be active");
if (!reviveAttempt.actionAttempt.includes('reviving')) throw new Error("Revive action should say 'reviving'");

// Test 20: Use item with invalid item id returns error
console.log("Test 20: use_item with bad itemId returns error...");
const { error: badItem } = GameEngine.applyItemUse(makeSession(), 'hero-1', 'no-such-item', 'hero-1');
if (!badItem) throw new Error("Should return error for missing item");
console.log(`- Error: "${badItem}"`);

// ── Phase 1: applyGiveItem ──────────────────────────────────────────────────

// Test 21: Give transferable item to ally
console.log("Test 21: Give transferable item to ally...");
const transferSword = { id: 'sword-1', name: 'Magic Blade', description: 'Glows faintly', transferable: true, consumable: false };
const giver = makeChar({ id: 'giver-1', name: 'Alice', inventory: [transferSword] });
const receiver = makeChar({ id: 'recv-1', name: 'Bob', inventory: [] });
const giveSession = makeSession({ party: [giver, receiver], activeCharacterId: 'giver-1' });
const { newState: afterGive, actionAttempt: giveAttempt } = GameEngine.applyGiveItem(giveSession, 'giver-1', 'sword-1', 'recv-1');
console.log(`- Giver inventory: ${afterGive.party[0].inventory.length}, Receiver: ${afterGive.party[1].inventory.length}`);
if (afterGive.party[0].inventory.length !== 0) throw new Error("Giver should have 0 items");
if (afterGive.party[1].inventory.length !== 1) throw new Error("Receiver should have 1 item");
if (afterGive.party[1].inventory[0].name !== 'Magic Blade') throw new Error("Receiver should have the sword");
if (!giveAttempt.actionAttempt.includes('gave') || !giveAttempt.actionAttempt.includes('Bob')) throw new Error("Action should describe the transfer");

// Test 22: Cannot give non-transferable item
console.log("Test 22: Cannot give non-transferable item...");
const soulBound = { id: 'soul-1', name: 'Soul Gem', description: 'Bound to you', transferable: false, consumable: false };
const soulChar = makeChar({ id: 'owner-1', inventory: [soulBound] });
const soulSession = makeSession({ party: [soulChar, makeChar({ id: 'other-1' })], activeCharacterId: 'owner-1' });
const { error: giveError } = GameEngine.applyGiveItem(soulSession, 'owner-1', 'soul-1', 'other-1');
if (!giveError) throw new Error("Should return error for non-transferable item");
if (soulSession.party[0].inventory.length !== 1) throw new Error("Original state should be unchanged");
console.log(`- Error: "${giveError}"`);

// Test 23: Cannot give item not in inventory
console.log("Test 23: Cannot give item not in inventory...");
const { error: missingItem } = GameEngine.applyGiveItem(makeSession({ party: [makeChar(), makeChar({ id: 'other-1' })] }), 'hero-1', 'ghost-item', 'other-1');
if (!missingItem) throw new Error("Should return error for item not in inventory");
console.log(`- Error: "${missingItem}"`);

// ── Integration: item use flows through updateState ─────────────────────────

// Test 24: Item state flows correctly through updateState
console.log("Test 24: Item use state flows through updateState...");
const flowPotion = { id: 'fp-1', name: 'Flask', description: 'Heals 2 HP', healValue: 2, consumable: true, transferable: false };
const flowChar = makeChar({ hp: 6, inventory: [flowPotion] });
const flowSession = makeSession({ party: [flowChar] });
const { newState: postItem, actionAttempt: flowAttempt } = GameEngine.applyItemUse(flowSession, 'hero-1', 'fp-1', 'hero-1');
const finalState = GameEngine.updateState(postItem, flowAttempt, { choices: [{ label: 'Continue', difficulty: 'easy', stat: 'might' }] });
console.log(`- Turn: ${finalState.turn}, HP: ${finalState.party[0].hp}, Inventory: ${finalState.party[0].inventory.length}`);
if (finalState.turn !== 2) throw new Error("Turn should advance to 2");
if (finalState.party[0].hp !== 8) throw new Error(`HP should be 8, got ${finalState.party[0].hp}`);
if (finalState.party[0].inventory.length !== 0) throw new Error("Consumable should be gone");

console.log("\nAll tests passed!");
