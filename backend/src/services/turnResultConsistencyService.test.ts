import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkTurnResultConsistency } from './turnResultConsistencyService.js';
import type { SessionState, ActionAttempt } from '../types.js';
import type { TurnResult } from '@dnd-fam-ftw/shared';

const warnSpy = vi.hoisted(() => vi.fn());
vi.mock('../lib/devLog.js', () => ({ devLog: { log: vi.fn(), warn: warnSpy } }));

const baseSession = (): SessionState => ({
  id: 'sess-1',
  scene: 'A dungeon corridor',
  turn: 1,
  displayName: 'Test Session',
  savingsMode: false,
  interventionState: { rescuesUsed: 0 },
  sceneId: 'scene-1',
  npcs: [],
  quests: [],
  lastChoices: [],
  tone: 'playful',
  recentHistory: [],
  difficulty: 'normal',
  storySummary: '',
  party: [{
    id: 'c1',
    name: 'Pip',
    class: 'Rogue',
    species: 'Halfling',
    quirk: 'sneaky',
    hp: 8,
    max_hp: 10,
    stats: { might: 1, magic: 2, mischief: 4 },
    status: 'active',
    inventory: [],
  }],
  activeCharacterId: 'c1',
});

const baseAttempt = (): ActionAttempt => ({
  actionAttempt: 'Sneak past the guard',
  actionResult: {
    success: true,
    roll: 14,
    statUsed: 'mischief',
    impact: 'normal',
  },
});

const baseResult = (): TurnResult => ({
  narration: 'Pip slips past the guard.',
  choices: [],
  imagePrompt: null,
  imageSuggested: false,
  suggestedInventoryAdd: null,
  suggestedInventoryRemove: null,
  suggestedInventoryUpdate: null,
  suggestedRevive: null,
  suggestedHeal: null,
  suggestedBuffAdd: null,
  suggestedBuffRemove: null,
  suggestedDamage: null,
  suggestedEncounterStart: null,
  suggestedEncounterUpdate: null,
  narrationFailed: false,
  narrationRetried: false,
  choicesFailed: false,
});

beforeEach(() => {
  warnSpy.mockClear();
});

describe('checkTurnResultConsistency - item gain', () => {
  it('warns when narration implies item gain but suggestedInventoryAdd is null', () => {
    const result = { ...baseResult(), narration: 'Pip finds a rusty key on the guard.' };
    checkTurnResultConsistency(result, baseSession(), baseAttempt());
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('item gain'));
  });

  it('does not warn when suggestedInventoryAdd is set', () => {
    const result = { ...baseResult(), narration: 'Pip finds a rusty key.', suggestedInventoryAdd: { name: '🔑 Rusty Key', description: 'A key', statBonuses: {}, healValue: 0, consumable: false, transferable: true } };
    checkTurnResultConsistency(result, baseSession(), baseAttempt());
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('item gain'));
  });

  it('does not warn for narration with no item-gain language', () => {
    const result = { ...baseResult(), narration: 'Pip rushes through the corridor.' };
    checkTurnResultConsistency(result, baseSession(), baseAttempt());
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('item gain'));
  });
});

describe('checkTurnResultConsistency - item loss', () => {
  it('warns when narration implies item loss but suggestedInventoryRemove is null', () => {
    const result = { ...baseResult(), narration: 'The thief steals the sword from Pip.' };
    checkTurnResultConsistency(result, baseSession(), baseAttempt());
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('item loss'));
  });

  it('does not warn when suggestedInventoryRemove is set', () => {
    const result = { ...baseResult(), narration: 'Pip loses the sword.', suggestedInventoryRemove: { characterName: 'Pip', itemName: '⚔️ Sword' } };
    checkTurnResultConsistency(result, baseSession(), baseAttempt());
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('item loss'));
  });
});

describe('checkTurnResultConsistency - revival', () => {
  it('warns when narration implies revival of downed character but suggestedRevive is null', () => {
    const session = { ...baseSession(), party: [{ ...baseSession().party[0], status: 'downed' as const }] };
    const result = { ...baseResult(), narration: 'Brom opens his eyes and rises to his feet.' };
    checkTurnResultConsistency(result, session, baseAttempt());
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('revival'));
  });

  it('does not warn when suggestedRevive is set', () => {
    const session = { ...baseSession(), party: [{ ...baseSession().party[0], status: 'downed' as const }] };
    const result = { ...baseResult(), narration: 'Brom opens his eyes.', suggestedRevive: { characterName: 'Brom', hp: 3 } };
    checkTurnResultConsistency(result, session, baseAttempt());
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('revival'));
  });

  it('does not warn for revival language when no downed character', () => {
    const result = { ...baseResult(), narration: 'Pip wakes up feeling refreshed after a nap.' };
    checkTurnResultConsistency(result, baseSession(), baseAttempt());
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('revival'));
  });
});

describe('checkTurnResultConsistency - encounter start', () => {
  it('warns when narration implies combat start but suggestedEncounterStart is null and no active encounter', () => {
    const result = { ...baseResult(), narration: 'Enemies burst from the treeline and charge at the party!' };
    checkTurnResultConsistency(result, baseSession(), baseAttempt());
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('encounter start'));
  });

  it('does not warn when suggestedEncounterStart is set', () => {
    const result = { ...baseResult(), narration: 'Goblins charge!', suggestedEncounterStart: { name: 'Goblin Ambush', enemies: [] } };
    checkTurnResultConsistency(result, baseSession(), baseAttempt());
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('encounter start'));
  });

  it('does not warn when encounter is already active', () => {
    const session = { ...baseSession(), encounterState: { id: 'enc-1', name: 'Battle', status: 'active' as const, enemies: [], areas: [], round: 1 } };
    const result = { ...baseResult(), narration: 'Enemies appear from the darkness.' };
    checkTurnResultConsistency(result, session, baseAttempt());
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('encounter start'));
  });

  it('does not warn for ordinary non-combat narration', () => {
    const result = { ...baseResult(), narration: 'Pip examines the ancient inscription on the wall.' };
    checkTurnResultConsistency(result, baseSession(), baseAttempt());
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('encounter start'));
  });
});
