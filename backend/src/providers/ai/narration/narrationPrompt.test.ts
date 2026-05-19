import { describe, it, expect } from 'vitest';
import { buildNarrationSystemPrompt, isTradeTurn, isRiddleTurn } from './narrationPrompt.js';
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

  it('always includes inventory section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).toContain('Inventory:');
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

  it('dmPrep with riddle keyword includes riddle section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput({ dmPrep: 'The sphinx poses a riddle to the party.' }));
    expect(prompt).toContain('RIDDLES AND PUZZLES');
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

  it('returns true when dmPrep mentions riddle', () => {
    expect(isRiddleTurn(makeRiddleInput({ dmPrep: 'The gate guardian poses a riddle.' }))).toBe(true);
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
});
