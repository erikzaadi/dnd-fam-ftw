import { describe, it, expect } from 'vitest';
import { buildNarrationSystemPrompt } from './narrationPrompt.js';
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

  it('always includes image strategy section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).toContain('Image Strategy');
  });

  it('always includes drama llama section', () => {
    const prompt = buildNarrationSystemPrompt(makeInput());
    expect(prompt).toContain('DRAMA LLAMA');
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
});
