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
  difficulty: "normal"
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

console.log("All tests passed!");
