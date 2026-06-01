import { describe, it, expect } from 'vitest';
import { buildNarrationSystemPrompt, isTradeTurn, isRiddleTurn } from './narrationPrompt.js';
import { buildChoicesAgentSystemPrompt } from './agentPrompts.js';
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

describe('buildNarrationSystemPrompt', () => {
  it('non-encounter turn does not include combat pacing section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).not.toContain('COMBAT PACING - Decisive Encounters');
  });

  it('non-encounter turn does not include active encounter section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).not.toContain('ACTIVE ENCOUNTER (encounterState)');
  });

  it('active encounter turn includes combat pacing section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({
      encounterState: { id: 'enc-1', name: 'Goblin Fight', status: 'active', enemies: [], areas: [], round: 1 },
    }));
    expect(prompt).toContain('COMBAT PACING - Decisive Encounters');
  });

  it('active encounter turn includes active encounter section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({
      encounterState: { id: 'enc-1', name: 'Goblin Fight', status: 'active', enemies: [], areas: [], round: 1 },
    }));
    expect(prompt).toContain('ACTIVE ENCOUNTER (encounterState)');
  });

  it('non-encounter turn does not include rest and recovery section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).not.toContain('REST AND RECOVERY');
  });

  it('sanctuary recovery turn includes rest and recovery section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ sanctuaryRecovery: true }));
    expect(prompt).toContain('REST AND RECOVERY');
  });

  it('intervention rescue turn includes rest and recovery section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ interventionRescue: true }));
    expect(prompt).toContain('REST AND RECOVERY');
  });

  it('non-buff turn does not include cute conditions section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).not.toContain('CUTE CONDITIONS AND BUFFS');
  });

  it('bless_character intent includes cute conditions section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ actionIntent: 'bless_character' }));
    expect(prompt).toContain('CUTE CONDITIONS AND BUFFS');
  });

  it('aid_character intent includes support action payoff section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ actionIntent: 'aid_character' }));
    expect(prompt).toContain('SUPPORT ACTION PAYOFF');
  });

  it('party_boost intent includes action intent section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ actionIntent: 'party_boost' }));
    expect(prompt).toContain('ACTION INTENT');
  });

  it('party with active buffs includes cute conditions section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({
      party: [{ name: 'Pip', class: 'Rogue', species: 'Halfling', hp: 8, maxHp: 10, stats: { might: 1, magic: 2, mischief: 4 }, status: 'active', buffs: [{ id: 'b1', name: 'Blessed', description: 'Lucky', statBonuses: { magic: 1 }, remainingTurns: 2 }] }],
    }));
    expect(prompt).toContain('CUTE CONDITIONS AND BUFFS');
  });

  it('always includes game pacing section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).toContain('GAME PACING (gameMode)');
  });

  it('always includes fail forward section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).toContain('FAIL FORWARD');
  });

  it('statUsed present includes drama llama section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ actionResult: { success: true, summary: 'ok', statUsed: 'magic' } }));
    expect(prompt).toContain('DRAMA LLAMA');
  });

  it('statUsed undefined excludes drama llama section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ actionResult: { success: true, summary: 'ok' } }));
    expect(prompt).not.toContain('DRAMA LLAMA');
  });

  it('includes difficulty, continuity, acting, choice-variety sections on plain turn', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).toContain('DYNAMIC DIFFICULTY');
    expect(prompt).toContain('Story Continuity');
    expect(prompt).toContain('Acting and Next Character');
    expect(prompt).toContain('Choice variety');
  });

  it('excludes inventory section when inventory is empty and not a loot turn', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ inventory: [] }));
    expect(prompt).not.toContain('Inventory:');
  });

  it('includes inventory section when inventory is non-empty', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({
      inventory: [{ name: '⚔️ Iron Sword', description: 'A sword', ownerName: 'Pip', statBonuses: {}, transferable: true, consumable: false }],
    }));
    expect(prompt).toContain('Inventory:');
  });

  it('excludes revival/healing section when nobody is downed and not a rest turn', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).not.toContain('CRITICAL - Character Revival');
  });

  it('includes revival/healing section when a character is downed', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({
      party: [
        { name: 'Pip', class: 'Rogue', species: 'Halfling', hp: 8, maxHp: 10, stats: { might: 1, magic: 2, mischief: 4 }, status: 'active' },
        { name: 'Brom', class: 'Warrior', species: 'Human', hp: 0, maxHp: 10, stats: { might: 4, magic: 1, mischief: 2 }, status: 'downed' },
      ],
    }));
    expect(prompt).toContain('CRITICAL - Character Revival');
  });

  it('includes damage section when action has a stat', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ actionResult: { success: true, summary: 'ok', statUsed: 'might' } }));
    expect(prompt).toContain('CRITICAL - Damage on Failure');
  });

  it('excludes damage section when action has no stat', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ actionResult: { success: true, summary: 'ok' } }));
    expect(prompt).not.toContain('CRITICAL - Damage on Failure');
  });

  it('non-buff turn does not include buffs curses format', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).not.toContain('Buffs and Curses:');
  });

  it('buff turn includes buffs curses format', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ actionIntent: 'improve_item' }));
    expect(prompt).toContain('Buffs and Curses:');
  });

  it('sceneMomentum present includes momentum directives section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ sceneMomentum: { directive: 'press_current_scene', suggestedNextBeat: 'Keep going', staleChoiceCount: 0, turnsSinceSceneChange: 1, turnsSinceCombat: 2, justCompletedCombat: false, justCompletedDifficultChallenge: false, reason: 'test' } }));
    expect(prompt).toContain('MOMENTUM DIRECTIVES');
  });

  it('no sceneMomentum excludes momentum directives section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).not.toContain('MOMENTUM DIRECTIVES');
  });

  it('active encounter includes combat loot section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({
      encounterState: { id: 'enc-1', name: 'Goblin Fight', status: 'active', enemies: [], areas: [], round: 1 },
    }));
    expect(prompt).toContain('COMBAT LOOT');
  });

  it('non-encounter turn excludes combat loot section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).not.toContain('COMBAT LOOT');
  });

  it('encounterJustResolved includes combat loot section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ encounterJustResolved: true }));
    expect(prompt).toContain('COMBAT LOOT');
  });

  it('action mentioning trade includes trade section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ actionAttempt: 'Buy a healing potion from the vendor' }));
    expect(prompt).toContain('PARTY AND NPC ITEM TRANSFERS');
  });

  it('vendor in recent history includes trade section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ recentHistory: ['The merchant offered silk scarves.'] }));
    expect(prompt).toContain('PARTY AND NPC ITEM TRANSFERS');
  });

  it('vendor keyword in scene includes trade section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ scene: 'A busy marketplace with a merchant stall' }));
    expect(prompt).toContain('PARTY AND NPC ITEM TRANSFERS');
  });

  it('no trade signal excludes trade section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ actionAttempt: 'Strike the goblin' }));
    expect(prompt).not.toContain('PARTY AND NPC ITEM TRANSFERS');
  });

  it('transferable items alone do not include trade section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({
      inventory: [{ name: 'Iron Shield', description: 'A shield', ownerName: 'Pip', statBonuses: {}, transferable: true, consumable: false }],
    }));
    expect(prompt).not.toContain('PARTY AND NPC ITEM TRANSFERS');
  });

  it('dmPrep with riddle keyword does not include riddle section (stale campaign brief, no current-turn signal)', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ dmPrep: 'The sphinx poses a riddle to the party.' }));
    expect(prompt).not.toContain('RIDDLES AND PUZZLES');
  });

  it('recent history with riddle mention includes riddle section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ recentHistory: ['The guardian posed a puzzle before the gate.'] }));
    expect(prompt).toContain('RIDDLES AND PUZZLES');
  });

  it('action containing riddle keyword includes riddle section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ actionAttempt: 'Answer the riddle of the stone door' }));
    expect(prompt).toContain('RIDDLES AND PUZZLES');
  });

  it('no riddle signal excludes riddle section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).not.toContain('RIDDLES AND PUZZLES');
  });
});

describe('stable prefix ordering', () => {
  it('system prompt preamble section comes before all conditional sections', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({
      sceneMomentum: { directive: 'press_current_scene', suggestedNextBeat: 'Go', staleChoiceCount: 0, turnsSinceSceneChange: 1, turnsSinceCombat: 2, justCompletedCombat: false, justCompletedDifficultChallenge: false, reason: 'test' },
      encounterState: { id: 'enc-1', name: 'Fight', status: 'active', enemies: [], areas: [], round: 1 },
    }));
    const preambleIdx = prompt.indexOf('GAME PACING (gameMode)');
    const momentumIdx = prompt.indexOf('MOMENTUM DIRECTIVES');
    const combatIdx = prompt.indexOf('COMBAT PACING - Decisive Encounters');
    expect(preambleIdx).toBeGreaterThanOrEqual(0);
    expect(preambleIdx).toBeLessThan(momentumIdx);
    expect(preambleIdx).toBeLessThan(combatIdx);
  });

  it('fail-forward section comes before choices format section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    const failIdx = prompt.indexOf('FAIL FORWARD');
    const choicesIdx = prompt.indexOf('Always return exactly 3 suggested actions');
    expect(failIdx).toBeGreaterThanOrEqual(0);
    expect(failIdx).toBeLessThan(choicesIdx);
  });

  it('party-status section comes before damage section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({
      actionResult: { success: true, summary: 'ok', statUsed: 'might' },
    }));
    const partyIdx = prompt.indexOf('Party Status:');
    const damageIdx = prompt.indexOf('CRITICAL - Damage on Failure');
    expect(partyIdx).toBeGreaterThanOrEqual(0);
    expect(partyIdx).toBeLessThan(damageIdx);
  });

  it('system prompt section order is deterministic across identical calls', () => {
    const input = makeInput({
      sceneMomentum: { directive: 'press_current_scene', suggestedNextBeat: 'Go', staleChoiceCount: 0, turnsSinceSceneChange: 1, turnsSinceCombat: 2, justCompletedCombat: false, justCompletedDifficultChallenge: false, reason: 'test' },
      actionResult: { success: true, summary: 'ok', statUsed: 'magic' },
    });
    expect(buildNarrationSystemPrompt(input)).toBe(buildNarrationSystemPrompt(input));
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

describe('buildNarrationSystemPrompt with Frozen Confrontation & Location Stall', () => {
  it('includes SECTION_FROZEN_CONFRONTATION when storySummary contains FROZEN CONFRONTATION', () => {
    const input = makeInput({
      storySummary: 'STORY SO FAR: The party arrived.\nFROZEN CONFRONTATION: Malakor the Defiler - targeted repeatedly but never escalated.'
    });
    const prompt = buildNarrationSystemPrompt(input);
    expect(prompt).toContain('FROZEN CONFRONTATION');
    expect(prompt).toContain('surface that character as a real encounter');
  });

  it('includes SECTION_LOCATION_STALL when storySummary contains LOCATION STALL', () => {
    const input = makeInput({
      storySummary: 'STORY SO FAR: The party arrived.\nLOCATION STALL: party remains in The Frozen Caves'
    });
    const prompt = buildNarrationSystemPrompt(input);
    expect(prompt).toContain('LOCATION STALL');
    expect(prompt).toContain('introduce a narrative hook this turn');
  });

  it('excludes both when storySummary does not contain them', () => {
    const input = makeInput({
      storySummary: 'STORY SO FAR: The party arrived.'
    });
    const prompt = buildNarrationSystemPrompt(input);
    expect(prompt).not.toContain('surface that character as a real encounter');
    expect(prompt).not.toContain('introduce a narrative hook this turn');
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
