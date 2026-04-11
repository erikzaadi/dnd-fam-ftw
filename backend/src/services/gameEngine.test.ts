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
  interventionState: { used: false },
  storySummary: '',
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

// ── Phase 1: applyIntervention ──────────────────────────────────────────────

// Test 25: applyIntervention restores all downed to 1 HP active
console.log("Test 25: applyIntervention restores all downed characters...");
const wipedSession = makeSession({
  party: [
    makeChar({ id: 'c1', status: 'downed', hp: 0 }),
    makeChar({ id: 'c2', status: 'downed', hp: 0 }),
  ],
  interventionState: { used: false },
});
const rescued = GameEngine.applyIntervention(wipedSession);
if (rescued.party[0].status !== 'active') throw new Error("char c1 should be active after intervention");
if (rescued.party[1].status !== 'active') throw new Error("char c2 should be active after intervention");
if (rescued.party[0].hp !== 1) throw new Error(`c1 HP should be 1, got ${rescued.party[0].hp}`);
if (rescued.party[1].hp !== 1) throw new Error(`c2 HP should be 1, got ${rescued.party[1].hp}`);
if (!rescued.interventionState.used) throw new Error("interventionState.used should be true");
console.log("- All downed restored to 1 HP active, intervention marked used.");

// Test 26: applyIntervention does not affect already-active characters
console.log("Test 26: applyIntervention leaves active characters alone...");
const mixedWipe = makeSession({
  party: [
    makeChar({ id: 'alive', status: 'active', hp: 7 }),
    makeChar({ id: 'down', status: 'downed', hp: 0 }),
  ],
  interventionState: { used: false },
});
const rescuedMixed = GameEngine.applyIntervention(mixedWipe);
if (rescuedMixed.party[0].hp !== 7) throw new Error("Active character HP should be unchanged");
if (rescuedMixed.party[1].hp !== 1) throw new Error("Downed character should be at 1 HP");
console.log("- Active character untouched, downed restored.");

// Test 27: isPartyWiped returns false after intervention
console.log("Test 27: isPartyWiped false after intervention...");
if (GameEngine.isPartyWiped(rescued)) throw new Error("Party should not be wiped after intervention");
console.log("- Correctly not wiped after rescue.");

// Test 28: intervention sets activeCharacterId to first party member
console.log("Test 28: intervention resets activeCharacterId...");
const session3 = makeSession({
  party: [makeChar({ id: 'first' }), makeChar({ id: 'second' })],
  activeCharacterId: 'second',
  interventionState: { used: false },
});
const afterIntervention = GameEngine.applyIntervention(session3);
if (afterIntervention.activeCharacterId !== 'first') throw new Error(`Expected 'first', got '${afterIntervention.activeCharacterId}'`);
console.log("- activeCharacterId reset to first party member.");

// ── Phase: applySanctuaryRecovery ───────────────────────────────────────────

// Test 29: applySanctuaryRecovery restores all downed to 1 HP
console.log("Test 29: applySanctuaryRecovery restores downed characters...");
const secondWipe = makeSession({
  party: [
    makeChar({ id: 's1', status: 'downed', hp: 0 }),
    makeChar({ id: 's2', status: 'downed', hp: 0 }),
  ],
  interventionState: { used: true },
});
const sanctuary = GameEngine.applySanctuaryRecovery(secondWipe);
if (sanctuary.party[0].status !== 'active') throw new Error('s1 should be active');
if (sanctuary.party[1].status !== 'active') throw new Error('s2 should be active');
if (sanctuary.party[0].hp !== 1) throw new Error(`s1 HP should be 1, got ${sanctuary.party[0].hp}`);
if (sanctuary.party[1].hp !== 1) throw new Error(`s2 HP should be 1, got ${sanctuary.party[1].hp}`);
console.log("- All downed restored to 1 HP active.");

// Test 30: applySanctuaryRecovery does NOT mark intervention used (already was)
console.log("Test 30: applySanctuaryRecovery leaves interventionState unchanged...");
if (!sanctuary.interventionState.used) throw new Error("interventionState.used should still be true");
console.log("- interventionState.used remains true.");

// Test 31: applySanctuaryRecovery resets activeCharacterId to first party member
console.log("Test 31: applySanctuaryRecovery resets activeCharacterId...");
const sanctuarySession = makeSession({
  party: [makeChar({ id: 'first' }), makeChar({ id: 'second' })],
  activeCharacterId: 'second',
  interventionState: { used: true },
});
const afterSanctuary = GameEngine.applySanctuaryRecovery(sanctuarySession);
if (afterSanctuary.activeCharacterId !== 'first') throw new Error(`Expected 'first', got '${afterSanctuary.activeCharacterId}'`);
console.log("- activeCharacterId reset to first party member.");

// Test 32: applySanctuaryRecovery does not affect active characters
console.log("Test 32: applySanctuaryRecovery leaves active characters alone...");
const mixedSanctuary = makeSession({
  party: [
    makeChar({ id: 'alive', status: 'active', hp: 5 }),
    makeChar({ id: 'dead', status: 'downed', hp: 0 }),
  ],
  interventionState: { used: true },
});
const afterMixed = GameEngine.applySanctuaryRecovery(mixedSanctuary);
if (afterMixed.party[0].hp !== 5) throw new Error("Active character HP should be unchanged");
if (afterMixed.party[1].hp !== 1) throw new Error("Downed character should be at 1 HP");
console.log("- Active character untouched.");

// ── suggestedRevive via updateState ────────────────────────────────────────

// Test 33: suggestedRevive revives a downed character
console.log("Test 33: suggestedRevive revives a downed party member...");
const t33Session = makeSession({
  party: [
    makeChar({ id: 'healer', name: 'Pip', status: 'active', hp: 8 }),
    makeChar({ id: 'downed-z', name: 'Zomgush', status: 'downed', hp: 0 }),
  ],
  activeCharacterId: 'healer',
});
const t33Attempt = { actionAttempt: 'Revive Zomgush using a healing ritual', actionResult: { success: true, roll: 20, statUsed: 'magic' as const } };
const t33After = GameEngine.updateState(t33Session, t33Attempt, {
  suggestedRevive: { characterName: 'Zomgush', hp: 3 },
  choices: [{ label: 'Continue', difficulty: 'easy', stat: 'might' }],
});
const t33Revived = t33After.party.find(c => c.name === 'Zomgush')!;
if (t33Revived.status !== 'active') throw new Error(`Expected active, got '${t33Revived.status}'`);
if (t33Revived.hp !== 3) throw new Error(`Expected hp 3, got ${t33Revived.hp}`);
console.log(`- Zomgush: status=${t33Revived.status}, hp=${t33Revived.hp} ✓`);

// Test 34: suggestedRevive hp is clamped to max_hp
console.log("Test 34: suggestedRevive hp clamped to max_hp...");
const clampSession = makeSession({
  party: [makeChar({ id: 'hero', name: 'Barnaby', status: 'downed', hp: 0, max_hp: 10 })],
  activeCharacterId: 'hero',
});
const clampAttempt = { actionAttempt: 'Full heal', actionResult: { success: true, roll: 15, statUsed: 'magic' as const } };
const afterClamp = GameEngine.updateState(clampSession, clampAttempt, {
  suggestedRevive: { characterName: 'Barnaby', hp: 999 },
  choices: [{ label: 'Go', difficulty: 'easy', stat: 'might' }],
});
if (afterClamp.party[0].hp !== 10) throw new Error(`Expected hp clamped to 10, got ${afterClamp.party[0].hp}`);
console.log(`- hp clamped to max_hp (10) ✓`);

// Test 35: suggestedRevive does not affect an already-active character
console.log("Test 35: suggestedRevive ignored for active characters...");
const activeSession = makeSession({
  party: [makeChar({ id: 'hero', name: 'Barnaby', status: 'active', hp: 5 })],
  activeCharacterId: 'hero',
});
const activeAttempt = { actionAttempt: 'Heal Barnaby', actionResult: { success: true, roll: 12, statUsed: 'magic' as const } };
const afterActive = GameEngine.updateState(activeSession, activeAttempt, {
  suggestedRevive: { characterName: 'Barnaby', hp: 10 },
  choices: [{ label: 'Go', difficulty: 'easy', stat: 'might' }],
});
if (afterActive.party[0].hp !== 5) throw new Error(`Active character HP should be unchanged (5), got ${afterActive.party[0].hp}`);
if (afterActive.party[0].status !== 'active') throw new Error('Status should still be active');
console.log(`- Active character unchanged ✓`);

// Test 36: suggestedRevive name match is case-insensitive
console.log("Test 36: suggestedRevive name match is case-insensitive...");
const caseSession = makeSession({
  party: [makeChar({ id: 'hero', name: 'Zomgush', status: 'downed', hp: 0 })],
  activeCharacterId: 'hero',
});
const caseAttempt = { actionAttempt: 'Revive', actionResult: { success: true, roll: 10, statUsed: 'magic' as const } };
const afterCase = GameEngine.updateState(caseSession, caseAttempt, {
  suggestedRevive: { characterName: 'zomgush', hp: 2 },
  choices: [{ label: 'Go', difficulty: 'easy', stat: 'might' }],
});
if (afterCase.party[0].status !== 'active') throw new Error(`Expected active after case-insensitive match`);
console.log(`- Case-insensitive match works ✓`);

// Test 37: null suggestedRevive leaves downed character unchanged
console.log("Test 37: null suggestedRevive leaves downed character unchanged...");
const noReviveSession = makeSession({
  party: [makeChar({ id: 'hero', name: 'Barnaby', status: 'downed', hp: 0 })],
  activeCharacterId: 'hero',
});
const noReviveAttempt = { actionAttempt: 'Do something else', actionResult: { success: true, roll: 10, statUsed: 'might' as const } };
const afterNoRevive = GameEngine.updateState(noReviveSession, noReviveAttempt, {
  suggestedRevive: null,
  choices: [{ label: 'Go', difficulty: 'easy', stat: 'might' }],
});
if (afterNoRevive.party[0].status !== 'downed') throw new Error('Downed character should remain downed');
console.log(`- Downed character unchanged ✓`);

// ── suggestedHeal via updateState ──────────────────────────────────────────

// Test 38: suggestedHeal heals an active party member
console.log("Test 38: suggestedHeal heals an active character...");
const t38Session = makeSession({
  party: [makeChar({ id: 'hero', name: 'Barnaby', status: 'active', hp: 4, max_hp: 10 })],
  activeCharacterId: 'hero',
});
const t38Attempt = { actionAttempt: 'Rest by the campfire', actionResult: { success: true, roll: 0, statUsed: 'none' as const } };
const afterHeal = GameEngine.updateState(t38Session, t38Attempt, {
  suggestedHeal: [{ characterName: 'Barnaby', hp: 3 }],
  choices: [{ label: 'Continue', difficulty: 'easy', stat: 'might' }],
});
if (afterHeal.party[0].hp !== 7) throw new Error(`Expected hp 7, got ${afterHeal.party[0].hp}`);
console.log(`- Barnaby healed from 4 to 7 ✓`);

// Test 39: suggestedHeal hp is clamped to max_hp
console.log("Test 39: suggestedHeal hp clamped to max_hp...");
const healClampSession = makeSession({
  party: [makeChar({ id: 'hero', name: 'Barnaby', status: 'active', hp: 8, max_hp: 10 })],
  activeCharacterId: 'hero',
});
const afterHealClamp = GameEngine.updateState(healClampSession, t38Attempt, {
  suggestedHeal: [{ characterName: 'Barnaby', hp: 99 }],
  choices: [{ label: 'Continue', difficulty: 'easy', stat: 'might' }],
});
if (afterHealClamp.party[0].hp !== 10) throw new Error(`Expected hp clamped to 10, got ${afterHealClamp.party[0].hp}`);
console.log(`- hp clamped to max_hp (10) ✓`);

// Test 40: suggestedHeal does NOT affect downed characters
console.log("Test 40: suggestedHeal does not affect downed characters...");
const downedHealSession = makeSession({
  party: [makeChar({ id: 'hero', name: 'Barnaby', status: 'downed', hp: 0, max_hp: 10 })],
  activeCharacterId: 'hero',
});
const afterDownedHeal = GameEngine.updateState(downedHealSession, t38Attempt, {
  suggestedHeal: [{ characterName: 'Barnaby', hp: 5 }],
  choices: [{ label: 'Continue', difficulty: 'easy', stat: 'might' }],
});
if (afterDownedHeal.party[0].hp !== 0) throw new Error(`Downed character should not be healed, got hp=${afterDownedHeal.party[0].hp}`);
if (afterDownedHeal.party[0].status !== 'downed') throw new Error('Downed character should remain downed');
console.log(`- Downed character unaffected by suggestedHeal ✓`);

// Test 41: suggestedHeal heals multiple characters at once
console.log("Test 41: suggestedHeal heals multiple active characters...");
const multiHealSession = makeSession({
  party: [
    makeChar({ id: 'c1', name: 'Pip', status: 'active', hp: 3, max_hp: 10 }),
    makeChar({ id: 'c2', name: 'Zomgush', status: 'active', hp: 2, max_hp: 8 }),
  ],
  activeCharacterId: 'c1',
});
const afterMultiHeal = GameEngine.updateState(multiHealSession, t38Attempt, {
  suggestedHeal: [
    { characterName: 'Pip', hp: 4 },
    { characterName: 'Zomgush', hp: 3 },
  ],
  choices: [{ label: 'Continue', difficulty: 'easy', stat: 'might' }],
});
if (afterMultiHeal.party[0].hp !== 7) throw new Error(`Expected Pip hp 7, got ${afterMultiHeal.party[0].hp}`);
if (afterMultiHeal.party[1].hp !== 5) throw new Error(`Expected Zomgush hp 5, got ${afterMultiHeal.party[1].hp}`);
console.log(`- Both characters healed correctly ✓`);

// Test 42: null suggestedHeal leaves HP unchanged
console.log("Test 42: null suggestedHeal leaves HP unchanged...");
const noHealSession = makeSession({
  party: [makeChar({ id: 'hero', name: 'Barnaby', status: 'active', hp: 5, max_hp: 10 })],
  activeCharacterId: 'hero',
});
const afterNoHeal = GameEngine.updateState(noHealSession, t38Attempt, {
  suggestedHeal: null,
  choices: [{ label: 'Continue', difficulty: 'easy', stat: 'might' }],
});
if (afterNoHeal.party[0].hp !== 5) throw new Error(`HP should be unchanged at 5, got ${afterNoHeal.party[0].hp}`);
console.log(`- HP unchanged with null suggestedHeal ✓`);

// Test 43: suggestedHeal name match is case-insensitive
console.log("Test 43: suggestedHeal name match is case-insensitive...");
const healCaseSession = makeSession({
  party: [makeChar({ id: 'hero', name: 'Barnaby', status: 'active', hp: 3, max_hp: 10 })],
  activeCharacterId: 'hero',
});
const afterHealCase = GameEngine.updateState(healCaseSession, t38Attempt, {
  suggestedHeal: [{ characterName: 'BARNABY', hp: 4 }],
  choices: [{ label: 'Continue', difficulty: 'easy', stat: 'might' }],
});
if (afterHealCase.party[0].hp !== 7) throw new Error(`Expected hp 7 after case-insensitive heal, got ${afterHealCase.party[0].hp}`);
console.log(`- Case-insensitive name match works ✓`);

console.log("\nAll tests passed!");
