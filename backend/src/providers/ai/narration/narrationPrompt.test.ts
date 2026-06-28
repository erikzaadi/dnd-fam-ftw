import { describe, it, expect } from 'vitest';
import { isTradeTurn, isRiddleTurn } from './narrationPrompt.js';
import {
  buildNarrationAgentSystemPrompt,
  buildChoicesAgentSystemPrompt,
  buildCombatAgentSystemPrompt,
  buildInventoryAgentSystemPrompt,
  buildRecoveryAgentSystemPrompt,
} from './agentPrompts.js';
import type { NarrationInput } from './NarrationProvider.js';

const makeInput = (overrides: Partial<NarrationInput> = {}): NarrationInput => ({
  scene: 'A dark dungeon',
  party: [{ name: 'Pip', class: 'Rogue', species: 'Halfling', hp: 8, maxHp: 10, stats: { might: 1, magic: 2, mischief: 4 }, status: 'active' }],
  inventory: [],
  actionAttempt: 'Sneak past the guard',
  actionResult: { success: true, summary: 'The action succeeded.' },
  recentHistory: [],
  tone: 'comedic',
  ...overrides,
});

const ACTIVE_ENCOUNTER_INPUT = {
  encounterState: { id: 'enc-1', name: 'Goblin Fight', status: 'active' as const, enemies: [], areas: [], round: 1 },
};

describe('buildNarrationAgentSystemPrompt', () => {
  it('always includes game pacing, fail forward, continuity, and acting sections', () => {
    const prompt = buildNarrationAgentSystemPrompt(makeInput());
    expect(prompt).toContain('GAME PACING (gameMode)');
    expect(prompt).toContain('FAIL FORWARD');
    expect(prompt).toContain('Story Continuity');
    expect(prompt).toContain('Acting and Next Character');
  });

  it('never includes choices, inventory, riddle, or vendor sections (other agents own them)', () => {
    const prompt = buildNarrationAgentSystemPrompt(makeInput({
      actionAttempt: 'Buy a healing potion from the vendor after solving the riddle',
      inventory: [{ name: '⚔️ Iron Sword', description: 'A sword', ownerName: 'Pip', statBonuses: {}, transferable: true, consumable: false }],
    }));
    expect(prompt).not.toContain('Always return exactly 3 suggested actions');
    expect(prompt).not.toContain('Inventory:');
    expect(prompt).not.toContain('RIDDLES AND PUZZLES');
    expect(prompt).not.toContain('PARTY AND NPC ITEM TRANSFERS');
  });

  it('non-encounter turn excludes combat sections', () => {
    const prompt = buildNarrationAgentSystemPrompt(makeInput());
    expect(prompt).not.toContain('COMBAT PACING - Decisive Encounters');
    expect(prompt).not.toContain('ACTIVE ENCOUNTER - Narration Context');
  });

  it('active encounter turn includes combat pacing and narration-scoped encounter context', () => {
    const prompt = buildNarrationAgentSystemPrompt(makeInput(ACTIVE_ENCOUNTER_INPUT));
    expect(prompt).toContain('COMBAT PACING - Decisive Encounters');
    expect(prompt).toContain('ACTIVE ENCOUNTER - Narration Context');
  });

  it('statUsed present includes drama llama section', () => {
    const prompt = buildNarrationAgentSystemPrompt(makeInput({ actionResult: { success: true, summary: 'ok', statUsed: 'magic' } }));
    expect(prompt).toContain('DRAMA LLAMA');
  });

  it('statUsed undefined excludes drama llama section', () => {
    const prompt = buildNarrationAgentSystemPrompt(makeInput({ actionResult: { success: true, summary: 'ok' } }));
    expect(prompt).not.toContain('DRAMA LLAMA');
  });

  it('sceneMomentum present includes momentum directives section', () => {
    const prompt = buildNarrationAgentSystemPrompt(makeInput({ sceneMomentum: { directive: 'press_current_scene', suggestedNextBeat: 'Keep going', staleChoiceCount: 0, turnsSinceSceneChange: 1, turnsSinceCombat: 2, justCompletedCombat: false, justCompletedDifficultChallenge: false, reason: 'test' } }));
    expect(prompt).toContain('MOMENTUM DIRECTIVES');
  });

  it('no sceneMomentum excludes momentum directives section', () => {
    const prompt = buildNarrationAgentSystemPrompt(makeInput());
    expect(prompt).not.toContain('MOMENTUM DIRECTIVES');
  });

  it('includes frozen confrontation section when storySummary contains FROZEN CONFRONTATION', () => {
    const prompt = buildNarrationAgentSystemPrompt(makeInput({
      storySummary: 'STORY SO FAR: The party arrived.\nFROZEN CONFRONTATION: Malakor the Defiler - targeted repeatedly but never escalated.',
    }));
    expect(prompt).toContain('FROZEN CONFRONTATION');
    expect(prompt).toContain('make that character\'s presence viscerally concrete');
  });

  it('includes location stall section when storySummary contains LOCATION STALL', () => {
    const prompt = buildNarrationAgentSystemPrompt(makeInput({
      storySummary: 'STORY SO FAR: The party arrived.\nLOCATION STALL: party remains in The Frozen Caves',
    }));
    expect(prompt).toContain('LOCATION STALL');
    expect(prompt).toContain('introduce a narrative hook this turn');
  });

  it('excludes frozen and stall sections when storySummary has no markers', () => {
    const prompt = buildNarrationAgentSystemPrompt(makeInput({
      storySummary: 'STORY SO FAR: The party arrived.',
    }));
    expect(prompt).not.toContain('make that character\'s presence viscerally concrete');
    expect(prompt).not.toContain('introduce a narrative hook this turn');
  });

  it('preamble comes before all conditional sections (stable prompt-cache prefix)', () => {
    const prompt = buildNarrationAgentSystemPrompt(makeInput({
      sceneMomentum: { directive: 'press_current_scene', suggestedNextBeat: 'Go', staleChoiceCount: 0, turnsSinceSceneChange: 1, turnsSinceCombat: 2, justCompletedCombat: false, justCompletedDifficultChallenge: false, reason: 'test' },
      ...ACTIVE_ENCOUNTER_INPUT,
    }));
    const preambleIdx = prompt.indexOf('GAME PACING (gameMode)');
    const momentumIdx = prompt.indexOf('MOMENTUM DIRECTIVES');
    const combatIdx = prompt.indexOf('COMBAT PACING - Decisive Encounters');
    expect(preambleIdx).toBeGreaterThanOrEqual(0);
    expect(preambleIdx).toBeLessThan(momentumIdx);
    expect(preambleIdx).toBeLessThan(combatIdx);
  });

  it('section order is deterministic across identical calls', () => {
    const input = makeInput({
      sceneMomentum: { directive: 'press_current_scene', suggestedNextBeat: 'Go', staleChoiceCount: 0, turnsSinceSceneChange: 1, turnsSinceCombat: 2, justCompletedCombat: false, justCompletedDifficultChallenge: false, reason: 'test' },
      actionResult: { success: true, summary: 'ok', statUsed: 'magic' },
    });
    expect(buildNarrationAgentSystemPrompt(input)).toBe(buildNarrationAgentSystemPrompt(input));
  });
});

describe('buildCombatAgentSystemPrompt', () => {
  it('always includes combat pacing, encounter state, and damage sections', () => {
    const prompt = buildCombatAgentSystemPrompt(makeInput(ACTIVE_ENCOUNTER_INPUT));
    expect(prompt).toContain('COMBAT PACING - Decisive Encounters');
    expect(prompt).toContain('ACTIVE ENCOUNTER (encounterState)');
    expect(prompt).toContain('CRITICAL - Damage on Failure');
  });

  it('never includes combat loot section (inventory module owns loot)', () => {
    const activeCombat = buildCombatAgentSystemPrompt(makeInput(ACTIVE_ENCOUNTER_INPUT));
    const lootResolved = buildCombatAgentSystemPrompt(makeInput({ encounterJustResolved: true }));
    const exploration = buildCombatAgentSystemPrompt(makeInput());
    expect(activeCombat).not.toContain('COMBAT LOOT');
    expect(lootResolved).not.toContain('COMBAT LOOT');
    expect(exploration).not.toContain('COMBAT LOOT');
  });
});

describe('buildInventoryAgentSystemPrompt', () => {
  it('always includes inventory basics section', () => {
    const prompt = buildInventoryAgentSystemPrompt(makeInput());
    expect(prompt).toContain('Inventory:');
  });

  it('trade action includes trade section', () => {
    const prompt = buildInventoryAgentSystemPrompt(makeInput({ actionAttempt: 'Buy a healing potion from the vendor' }));
    expect(prompt).toContain('PARTY AND NPC ITEM TRANSFERS');
  });

  it('ordinary action excludes trade section', () => {
    const prompt = buildInventoryAgentSystemPrompt(makeInput());
    expect(prompt).not.toContain('PARTY AND NPC ITEM TRANSFERS');
  });

  it('active encounter includes combat loot section', () => {
    const prompt = buildInventoryAgentSystemPrompt(makeInput(ACTIVE_ENCOUNTER_INPUT));
    expect(prompt).toContain('COMBAT LOOT');
  });

  it('post-combat turn includes combat loot section', () => {
    const prompt = buildInventoryAgentSystemPrompt(makeInput({ encounterJustResolved: true }));
    expect(prompt).toContain('COMBAT LOOT');
  });

  it('ordinary turn excludes combat loot section', () => {
    const prompt = buildInventoryAgentSystemPrompt(makeInput());
    expect(prompt).not.toContain('COMBAT LOOT');
  });
});

describe('buildRecoveryAgentSystemPrompt', () => {
  it('always includes revival/healing and party status sections', () => {
    const prompt = buildRecoveryAgentSystemPrompt(makeInput({
      party: [
        { name: 'Pip', class: 'Rogue', species: 'Halfling', hp: 8, maxHp: 10, stats: { might: 1, magic: 2, mischief: 4 }, status: 'active' },
        { name: 'Brom', class: 'Warrior', species: 'Human', hp: 0, maxHp: 10, stats: { might: 4, magic: 1, mischief: 2 }, status: 'downed' },
      ],
    }));
    expect(prompt).toContain('CRITICAL - Character Revival');
    expect(prompt).toContain('Party Status:');
  });

  it('sanctuary recovery turn includes rest and recovery section', () => {
    const prompt = buildRecoveryAgentSystemPrompt(makeInput({ sanctuaryRecovery: true }));
    expect(prompt).toContain('REST AND RECOVERY');
  });

  it('intervention rescue turn includes rest and recovery section', () => {
    const prompt = buildRecoveryAgentSystemPrompt(makeInput({ interventionRescue: true }));
    expect(prompt).toContain('REST AND RECOVERY');
  });

  it('ordinary turn excludes rest and recovery section', () => {
    const prompt = buildRecoveryAgentSystemPrompt(makeInput());
    expect(prompt).not.toContain('REST AND RECOVERY');
  });

  it('party with active buffs includes buffs curses format section', () => {
    const prompt = buildRecoveryAgentSystemPrompt(makeInput({
      party: [{ name: 'Pip', class: 'Rogue', species: 'Halfling', hp: 8, maxHp: 10, stats: { might: 1, magic: 2, mischief: 4 }, status: 'active', buffs: [{ id: 'b1', name: 'Blessed', description: 'Lucky', statBonuses: { magic: 1 }, remainingTurns: 2 }] }],
    }));
    expect(prompt).toContain('Buffs and Curses:');
  });

  it('buff intent includes support payoff and action intent sections', () => {
    const prompt = buildRecoveryAgentSystemPrompt(makeInput({ actionIntent: 'bless_character' }));
    expect(prompt).toContain('SUPPORT ACTION PAYOFF');
    expect(prompt).toContain('ACTION INTENT');
  });

  it('ordinary turn excludes buff sections', () => {
    const prompt = buildRecoveryAgentSystemPrompt(makeInput());
    expect(prompt).not.toContain('Buffs and Curses:');
    expect(prompt).not.toContain('SUPPORT ACTION PAYOFF');
  });
});

describe('isTradeTurn', () => {
  const makeTradeInput = (overrides: Partial<NarrationInput> = {}): NarrationInput => ({
    scene: 'A dark dungeon',
    party: [{ name: 'Pip', class: 'Rogue', species: 'Halfling', hp: 8, maxHp: 10, stats: { might: 1, magic: 2, mischief: 4 }, status: 'active' }],
    inventory: [],
    actionAttempt: 'Look around',
    actionResult: { success: true, summary: 'ok' },
    recentHistory: [],
    tone: 'comedic',
    ...overrides,
  });

  it('returns true when action mentions vendor', () => {
    expect(isTradeTurn(makeTradeInput({ actionAttempt: 'Talk to the vendor' }))).toBe(true);
  });

  it('returns true when action mentions trade', () => {
    expect(isTradeTurn(makeTradeInput({ actionAttempt: 'Trade the sword for coin' }))).toBe(true);
  });

  it('returns true when recent history mentions merchant', () => {
    expect(isTradeTurn(makeTradeInput({ recentHistory: ['A merchant called out from a stall.'] }))).toBe(true);
  });

  it('returns true when scene mentions shop', () => {
    expect(isTradeTurn(makeTradeInput({ scene: 'A shop filled with exotic goods' }))).toBe(true);
  });

  it('returns false with no trade signal', () => {
    expect(isTradeTurn(makeTradeInput())).toBe(false);
  });

  it('returns false when inventory has transferable items but no trade signal', () => {
    expect(isTradeTurn(makeTradeInput({
      inventory: [{ name: 'Iron Shield', description: 'A shield', ownerName: 'Pip', statBonuses: {}, transferable: true, consumable: false }],
    }))).toBe(false);
  });

  it('returns false when trade was mentioned more than 2 turns ago', () => {
    expect(isTradeTurn(makeTradeInput({
      recentHistory: ['A merchant appeared.', 'You moved on.', 'You entered a cave.', 'You fought a goblin.'],
    }))).toBe(false);
  });

  it('returns false during active combat when only history has trade signal', () => {
    expect(isTradeTurn(makeTradeInput({
      encounterState: { id: 'enc-1', status: 'active', name: 'Goblin Fight', enemies: [], areas: [], round: 1 },
      recentHistory: ['A merchant called out from a stall.'],
    }))).toBe(false);
  });

  it('returns false during active combat when only scene has trade signal', () => {
    expect(isTradeTurn(makeTradeInput({
      encounterState: { id: 'enc-1', status: 'active', name: 'Goblin Fight', enemies: [], areas: [], round: 1 },
      scene: 'A shop filled with exotic goods',
    }))).toBe(false);
  });

  it('returns true during active combat when action explicitly has trade keyword', () => {
    expect(isTradeTurn(makeTradeInput({
      encounterState: { id: 'enc-1', status: 'active', name: 'Goblin Fight', enemies: [], areas: [], round: 1 },
      actionAttempt: 'Give the healing potion to Zara',
    }))).toBe(true);
  });
});

describe('isRiddleTurn', () => {
  const makeRiddleInput = (overrides: Partial<NarrationInput> = {}): NarrationInput => ({
    scene: 'A dark dungeon',
    party: [{ name: 'Pip', class: 'Rogue', species: 'Halfling', hp: 8, maxHp: 10, stats: { might: 1, magic: 2, mischief: 4 }, status: 'active' }],
    inventory: [],
    actionAttempt: 'Move forward',
    actionResult: { success: true, summary: 'ok' },
    recentHistory: [],
    tone: 'comedic',
    ...overrides,
  });

  it('returns false when only dmPrep mentions riddle (stale campaign brief, no current-turn signal)', () => {
    expect(isRiddleTurn(makeRiddleInput({ dmPrep: 'The gate guardian poses a riddle.' }))).toBe(false);
  });

  it('returns true when scene mentions puzzle', () => {
    expect(isRiddleTurn(makeRiddleInput({ scene: 'A room with a puzzle lock on the door' }))).toBe(true);
  });

  it('returns true when action mentions password', () => {
    expect(isRiddleTurn(makeRiddleInput({ actionAttempt: 'Speak the password to pass' }))).toBe(true);
  });

  it('returns true when recent history mentions cipher', () => {
    expect(isRiddleTurn(makeRiddleInput({ recentHistory: ['The inscription showed a cipher.'] }))).toBe(true);
  });

  it('returns false with no riddle signal', () => {
    expect(isRiddleTurn(makeRiddleInput())).toBe(false);
  });

  it('returns false when answer appears without riddle context', () => {
    expect(isRiddleTurn(makeRiddleInput({ actionAttempt: 'Answer the goblin back with a shout' }))).toBe(false);
  });

  it('returns false when riddle was in history more than 2 turns ago', () => {
    expect(isRiddleTurn(makeRiddleInput({
      recentHistory: ['The sphinx posed a riddle.', 'You answered.', 'The door opened.', 'You entered the vault.'],
    }))).toBe(false);
  });

  it('returns true when riddle is in one of the last 2 history entries', () => {
    expect(isRiddleTurn(makeRiddleInput({
      recentHistory: ['You entered the vault.', 'The sphinx posed a new puzzle.'],
    }))).toBe(true);
  });
});

// The "fullest" input compiles the largest possible prompt (active combat, downed
// party, trade keyword, special intents). Ownership tests use this to catch any
// cross-domain leakage that only appears under specific conditional sections.
const makeFullInput = (): NarrationInput => makeInput({
  encounterState: { id: 'enc-1', name: 'Goblin Fight', status: 'active' as const, enemies: [], areas: [], round: 2 },
  party: [
    { name: 'Pip', class: 'Rogue', species: 'Halfling', hp: 8, maxHp: 10, stats: { might: 1, magic: 2, mischief: 4 }, status: 'active', buffs: [{ id: 'b1', name: 'Blessed', description: 'Lucky', statBonuses: { magic: 1 }, remainingTurns: 2 }] },
    { name: 'Brom', class: 'Warrior', species: 'Human', hp: 0, maxHp: 10, stats: { might: 4, magic: 1, mischief: 2 }, status: 'downed' },
  ],
  actionAttempt: 'Give the healing potion to Brom',
  actionResult: { success: true, summary: 'ok', statUsed: 'magic' },
  actionIntent: 'bless_character',
  sceneMomentum: { directive: 'climax_pressure' as const, suggestedNextBeat: 'suggestedEncounterStart', staleChoiceCount: 0, turnsSinceSceneChange: 3, turnsSinceCombat: 0, justCompletedCombat: false, justCompletedDifficultChallenge: false, reason: 'test' },
  storySummary: 'STORY SO FAR: The dungeon deepens.\nFROZEN CONFRONTATION: Malakor the Defiler - lurking nearby.',
  interventionRescue: true,
  sanctuaryRecovery: false,
  recentHistory: ['A merchant appeared.'],
  inventory: [{ name: '⚔️ Iron Sword', description: 'A sword', ownerName: 'Pip', statBonuses: {}, transferable: true, consumable: false }],
});

describe('prompt ownership - narration agent never instructs inventory-owned fields', () => {
  // suggestedDamage and suggestedEncounterStart appear in the narration prompt only
  // in negation contexts ("do NOT set X") - that is intentional. The assertions below
  // cover inventory-owned fields that were removed in Phase 2 and must stay removed.
  it('never contains inventory field names from any conditional section', () => {
    const prompt = buildNarrationAgentSystemPrompt(makeFullInput());
    expect(prompt).not.toContain('suggestedInventoryAdd');
    expect(prompt).not.toContain('suggestedInventoryRemove');
    expect(prompt).not.toContain('suggestedInventoryUpdate');
  });
});

describe('prompt ownership - combat agent never instructs cross-domain fields', () => {
  it('never contains inventory-owned field names', () => {
    const prompt = buildCombatAgentSystemPrompt(makeFullInput());
    expect(prompt).not.toContain('suggestedInventoryAdd');
    expect(prompt).not.toContain('suggestedInventoryRemove');
    expect(prompt).not.toContain('suggestedInventoryUpdate');
  });

  it('never contains recovery-owned field names', () => {
    const prompt = buildCombatAgentSystemPrompt(makeFullInput());
    expect(prompt).not.toContain('suggestedRevive');
    expect(prompt).not.toContain('suggestedHeal');
    expect(prompt).not.toContain('suggestedBuffAdd');
    expect(prompt).not.toContain('suggestedBuffRemove');
  });
});

describe('prompt ownership - inventory agent never instructs cross-domain fields', () => {
  it('never contains recovery-owned field names', () => {
    const prompt = buildInventoryAgentSystemPrompt(makeFullInput());
    expect(prompt).not.toContain('suggestedRevive');
    expect(prompt).not.toContain('suggestedHeal');
    expect(prompt).not.toContain('suggestedBuffAdd');
    expect(prompt).not.toContain('suggestedBuffRemove');
  });

  it('never contains combat-owned field names', () => {
    const prompt = buildInventoryAgentSystemPrompt(makeFullInput());
    expect(prompt).not.toContain('suggestedDamage');
    expect(prompt).not.toContain('suggestedEncounterStart');
  });
});

describe('prompt ownership - recovery agent never instructs inventory-owned fields', () => {
  it('never contains inventory field names from any conditional section', () => {
    const prompt = buildRecoveryAgentSystemPrompt(makeFullInput());
    expect(prompt).not.toContain('suggestedInventoryAdd');
    expect(prompt).not.toContain('suggestedInventoryRemove');
    expect(prompt).not.toContain('suggestedInventoryUpdate');
  });
});

describe('buildChoicesAgentSystemPrompt - vendor/trade section', () => {
  it('includes vendor section when action mentions trade keyword', () => {
    const prompt = buildChoicesAgentSystemPrompt(makeInput({ actionAttempt: 'Buy a healing potion from the vendor' }));
    expect(prompt).toContain('VENDOR');
  });

  it('excludes vendor section for ordinary non-trade action', () => {
    const prompt = buildChoicesAgentSystemPrompt(makeInput({ actionAttempt: 'Sneak past the guard' }));
    expect(prompt).not.toContain('VENDOR');
  });
});

describe('buildChoicesAgentSystemPrompt - riddle section', () => {
  it('includes riddle section when recent history mentions riddle', () => {
    const prompt = buildChoicesAgentSystemPrompt(makeInput({ recentHistory: ['The sphinx poses a riddle to the party.'] }));
    expect(prompt).toContain('RIDDLE');
  });

  it('excludes riddle section for ordinary action with no riddle signal', () => {
    const prompt = buildChoicesAgentSystemPrompt(makeInput({ actionAttempt: 'Sneak past the guard' }));
    expect(prompt).not.toContain('RIDDLE');
  });
});
