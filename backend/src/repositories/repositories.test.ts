import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { characterRepository } from './characterRepository.js';
import { inviteRequestRepository } from './inviteRequestRepository.js';
import { namespaceRepository } from './namespaceRepository.js';
import { sessionRepository } from './sessionRepository.js';
import { turnHistoryRepository } from './turnHistoryRepository.js';
import { usageRepository } from './usageRepository.js';
import { userRepository } from './userRepository.js';
import { seedOnboarding, ONBOARDING_TEMPLATE_SESSION_ID } from '../scripts/seedOnboarding.js';
import type { SessionState } from '../types.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-repository-test-${Date.now()}.sqlite`);
const IMAGE_PATH = path.join(os.tmpdir(), `dnd-repository-images-${Date.now()}`);

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.LOCAL_IMAGE_STORAGE_PATH = IMAGE_PATH;
  process.env.LOCAL_IMAGE_PUBLIC_BASE_URL = '/test-images';
  process.env.IMAGE_STORAGE_PROVIDER = 'local';
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1';
  process.env.OPENAI_API_KEY = 'test-invalid-key';
  initializeDatabase();
});

afterAll(() => {
  for (const filePath of [DB_PATH, IMAGE_PATH]) {
    try {
      fs.rmSync(filePath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

const insertSession = (id: string, namespaceId = 'local') => {
  getDb().prepare(
    'INSERT INTO sessions (id, scene, sceneId, worldDescription, turn, tone, displayName, difficulty, gameMode, useLocalAI, savingsMode, namespace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, 'Repository Scene', 'repo-1', 'A focused repository test world', 1, 'measured adventure', 'Repository Test', 'normal', 'balanced', 0, 0, namespaceId);
};

describe('sessionRepository', () => {
  it('persists and loads inventory item flags', async () => {
    insertSession('repo-session-inventory');
    const state: SessionState = {
      id: 'repo-session-inventory',
      scene: 'Repository Scene',
      sceneId: 'repo-2',
      worldDescription: 'A focused repository test world',
      turn: 2,
      party: [{
        id: 'repo-char-inventory',
        name: 'Archivist',
        class: 'Cleric',
        species: 'Human',
        quirk: 'Catalogs everything',
        hp: 8,
        max_hp: 10,
        status: 'active',
        stats: { might: 1, magic: 3, mischief: 2 },
        inventory: [{
          id: 'repo-item-tonic',
          name: 'Field Tonic',
          description: 'Restores resolve',
          statBonuses: { magic: 1, mischief: 2 },
          healValue: 4,
          transferable: true,
          consumable: true,
        }],
      }],
      activeCharacterId: 'repo-char-inventory',
      npcs: [],
      quests: [],
      lastChoices: [],
      tone: 'measured adventure',
      recentHistory: [],
      displayName: 'Repository Test',
      difficulty: 'normal',
      gameMode: 'balanced',
      savingsMode: false,
      useLocalAI: false,
      interventionState: { rescuesUsed: 0 },
      storySummary: '',
      gameOver: false,
    };

    await sessionRepository.updateSession('repo-session-inventory', state);

    const loaded = await sessionRepository.getSession('repo-session-inventory');
    expect(loaded?.party[0].inventory[0]).toMatchObject({
      id: 'repo-item-tonic',
      healValue: 4,
      transferable: true,
      consumable: true,
      statBonuses: { magic: 1, mischief: 2 },
    });
  });
});

describe('turnHistoryRepository', () => {
  it('round-trips action, choices, HP changes, and inventory changes', async () => {
    insertSession('repo-turn-history');
    getDb().prepare(
      'INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('repo-turn-char', 'repo-turn-history', 'Ranger', 'Ranger', 'Elf', 'Always prepared', 7, 10, 2, 2, 3, 'active');

    await turnHistoryRepository.addTurnResult('repo-turn-history', {
      narration: 'The ranger steadies the group.',
      rollNarration: 'The result lands cleanly.',
      imagePrompt: 'a ranger in a moonlit ruin',
      imageSuggested: true,
      imageUrl: null,
      choices: [{ label: 'Scout ahead', difficulty: 'normal', stat: 'mischief', difficultyValue: 11, narration: 'Move quietly.', riddleAnswer: 'a river', riddleCorrect: true }],
      lastAction: {
        actionAttempt: 'Steady the group',
        actionResult: { success: true, roll: 18, statUsed: 'magic', statBonus: 2, itemBonus: 1, isCritical: true, difficultyTarget: 14 },
      },
      hpChanges: [{ characterId: 'repo-turn-char', characterName: 'Ranger', change: -1, newHp: 7, maxHp: 10 }],
      inventoryChanges: [{ characterName: 'Ranger', itemName: 'Signal Whistle', type: 'added' }],
      turnType: 'normal',
      currentTensionLevel: 'medium',
    }, 'repo-turn-char');

    const history = await turnHistoryRepository.getTurnHistory('repo-turn-history');
    expect(history).toHaveLength(1);
    expect(history[0].choices[0]).toMatchObject({ label: 'Scout ahead', difficultyValue: 11, narration: 'Move quietly.', riddleAnswer: 'a river', riddleCorrect: true });
    expect(history[0].lastAction?.actionResult).toMatchObject({
      success: true,
      roll: 18,
      statUsed: 'magic',
      statBonus: 2,
      itemBonus: 1,
      isCritical: true,
      difficultyTarget: 14,
    });
    expect(history[0].hpChanges).toEqual([{ characterId: 'repo-turn-char', characterName: 'Ranger', change: -1, newHp: 7, maxHp: 10 }]);
    expect(history[0].inventoryChanges).toEqual([{ characterName: 'Ranger', itemName: 'Signal Whistle', type: 'added' }]);
    expect(turnHistoryRepository.getCharacterTurnHistory('repo-turn-char')).toEqual([
      { narration: 'The ranger steadies the group.', actionAttempt: 'Steady the group' },
    ]);
  });
});

describe('characterRepository', () => {
  it('finds a character session and deletes character inventory', async () => {
    insertSession('repo-character-session');
    getDb().prepare(
      'INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('repo-character-delete', 'repo-character-session', 'Scribe', 'Wizard', 'Gnome', 'Footnotes danger', 6, 8, 1, 4, 2, 'active');
    getDb().prepare('INSERT INTO inventory (characterId, itemId, name, description) VALUES (?, ?, ?, ?)')
      .run('repo-character-delete', 'repo-note', 'Annotated Map', 'Marked with routes');

    expect(await characterRepository.getSessionIdForCharacter('repo-character-delete')).toBe('repo-character-session');
    characterRepository.deleteCharacter('repo-character-delete');
    expect(await characterRepository.getSessionIdForCharacter('repo-character-delete')).toBeNull();
    const inventory = getDb().prepare('SELECT id FROM inventory WHERE characterId = ?').all('repo-character-delete');
    expect(inventory).toHaveLength(0);
  });
});

describe('userRepository and namespaceRepository', () => {
  it('preserves namespace membership when changing primary namespace', () => {
    const { namespaceId: primaryNamespaceId } = userRepository.createUser('repo-member@example.com');
    const { namespaceId: secondaryNamespaceId } = namespaceRepository.createNamespace('Repository Secondary');
    const user = userRepository.getUserByEmail('repo-member@example.com');
    expect(user).not.toBeNull();

    userRepository.addUserToNamespace(user!.id, secondaryNamespaceId);
    userRepository.setPrimaryNamespace(user!.id, secondaryNamespaceId);

    expect(userRepository.getUserByEmail('repo-member@example.com')?.namespace_id).toBe(secondaryNamespaceId);
    const namespaces = userRepository.getUserNamespaces('repo-member@example.com').map(ns => ns.id);
    expect(namespaces).toContain(primaryNamespaceId);
    expect(namespaces).toContain(secondaryNamespaceId);
  });

  it('refuses to delete namespaces with users or sessions', () => {
    const { namespaceId: userNamespaceId } = userRepository.createUser('repo-namespace-user@example.com');
    expect(namespaceRepository.deleteNamespace(userNamespaceId)).toMatchObject({ ok: false });

    const { namespaceId: sessionNamespaceId } = namespaceRepository.createNamespace('Repository Session Namespace');
    insertSession('repo-session-namespace-delete', sessionNamespaceId);
    const result = namespaceRepository.deleteNamespace(sessionNamespaceId);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/session/);
  });
});

describe('inviteRequestRepository', () => {
  it('ignores duplicate invite requests', () => {
    expect(inviteRequestRepository.hasInviteRequest('repo-invite@example.com')).toBe(false);
    inviteRequestRepository.addInviteRequest('repo-invite@example.com', 'First request');
    inviteRequestRepository.addInviteRequest('repo-invite@example.com', 'Second request');

    const requests = inviteRequestRepository.listInviteRequests().filter(request => request.email === 'repo-invite@example.com');
    expect(requests).toHaveLength(1);
    expect(requests[0].message).toBe('First request');
  });
});

describe('usageRepository', () => {
  it('aggregates TTS request and character counts by namespace', () => {
    const { namespaceId } = namespaceRepository.createNamespace('Repository Usage Namespace');
    usageRepository.recordTtsUsage(namespaceId, 'voice-a', 20);
    usageRepository.recordTtsUsage(namespaceId, 'voice-b', 30);
    usageRepository.recordTtsUsage('local', 'voice-a', 99);

    expect(usageRepository.getTtsUsage(namespaceId)).toEqual({ requestCount: 2, characterCount: 50 });
  });
});

describe('sessionRepository.cloneOnboardingSession', () => {
  beforeAll(() => {
    seedOnboarding(getDb());
  });

  it('throws when template is missing', () => {
    getDb().prepare('DELETE FROM turn_choices WHERE turnId IN (SELECT id FROM turn_history WHERE sessionId = ?)').run(ONBOARDING_TEMPLATE_SESSION_ID);
    getDb().prepare('DELETE FROM turn_history WHERE sessionId = ?').run(ONBOARDING_TEMPLATE_SESSION_ID);
    getDb().prepare('DELETE FROM inventory WHERE characterId IN (SELECT id FROM characters WHERE sessionId = ?)').run(ONBOARDING_TEMPLATE_SESSION_ID);
    getDb().prepare('DELETE FROM characters WHERE sessionId = ?').run(ONBOARDING_TEMPLATE_SESSION_ID);
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(ONBOARDING_TEMPLATE_SESSION_ID);

    expect(() => sessionRepository.cloneOnboardingSession('local')).toThrow('Onboarding template not found');

    seedOnboarding(getDb());
  });

  it('produces a new session with a fresh ID in the target namespace', () => {
    const newId = sessionRepository.cloneOnboardingSession('local');
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(ONBOARDING_TEMPLATE_SESSION_ID);

    const row = getDb().prepare('SELECT namespace_id, displayName, difficulty, preview_image_url FROM sessions WHERE id = ?').get(newId) as { namespace_id: string; displayName: string; difficulty: string; preview_image_url: string | null };
    expect(row.namespace_id).toBe('local');
    expect(row.displayName).toBe('A Crumby Situation');
    expect(row.difficulty).toBe('easy');
    expect(row.preview_image_url).toBe('/images/onboarding/preview.png');
  });

  it('copies all 4 characters with correct stats and avatar URLs', () => {
    const newId = sessionRepository.cloneOnboardingSession('local');
    const chars = getDb().prepare('SELECT name, class, might, magic, mischief, avatarUrl FROM characters WHERE sessionId = ? ORDER BY rowid ASC').all(newId) as { name: string; class: string; might: number; magic: number; mischief: number; avatarUrl: string | null }[];
    expect(chars).toHaveLength(4);
    expect(chars[0]).toMatchObject({ name: 'Brom Ironbread', class: 'Fighter', might: 5, magic: 1, mischief: 1 });
    expect(chars[1]).toMatchObject({ name: 'Finn Quickcrust', class: 'Rogue', mischief: 5 });
    expect(chars[2]).toMatchObject({ name: 'Zara Spellsworth', class: 'Mage', magic: 5, avatarUrl: '/images/onboarding/avatar_zara.png' });
    expect(chars[3]).toMatchObject({ name: 'Mira Warmheal', class: 'Cleric' });
  });

  it('copies inventory items per character', () => {
    const newId = sessionRepository.cloneOnboardingSession('local');
    const chars = getDb().prepare('SELECT id FROM characters WHERE sessionId = ? ORDER BY rowid ASC').all(newId) as { id: string }[];
    const miraItems = getDb().prepare('SELECT name FROM inventory WHERE characterId = ?').all(chars[3].id) as { name: string }[];
    const zaraItems = getDb().prepare('SELECT name FROM inventory WHERE characterId = ?').all(chars[2].id) as { name: string }[];
    expect(miraItems.some(i => i.name.includes('Healing Potion'))).toBe(true);
    expect(zaraItems.some(i => i.name.includes('Arcane Crouton'))).toBe(true);
  });

  it('copies all 5 turns with choices and scene image URLs', () => {
    const newId = sessionRepository.cloneOnboardingSession('local');
    const turns = getDb().prepare('SELECT id, imageUrl FROM turn_history WHERE sessionId = ? ORDER BY id ASC').all(newId) as { id: number; imageUrl: string | null }[];
    expect(turns).toHaveLength(5);
    expect(turns[0].imageUrl).toBe('/images/onboarding/scene_inn.png');
    expect(turns[1].imageUrl).toBe('/images/onboarding/scene_brom.png');

    const choices = getDb().prepare('SELECT label FROM turn_choices WHERE turnId = ?').all(turns[0].id) as { label: string }[];
    expect(choices).toHaveLength(3);
  });

  it('maps activeCharacterId to the cloned character ID', () => {
    const newId = sessionRepository.cloneOnboardingSession('local');
    const session = getDb().prepare('SELECT activeCharacterId FROM sessions WHERE id = ?').get(newId) as { activeCharacterId: string };
    const char = getDb().prepare('SELECT id FROM characters WHERE id = ?').get(session.activeCharacterId) as { id: string } | undefined;
    expect(char).toBeDefined();
  });

  it('produces independent sessions when cloned twice', () => {
    const id1 = sessionRepository.cloneOnboardingSession('local');
    const id2 = sessionRepository.cloneOnboardingSession('local');
    expect(id1).not.toBe(id2);

    const chars1 = getDb().prepare('SELECT id FROM characters WHERE sessionId = ?').all(id1) as { id: string }[];
    const chars2 = getDb().prepare('SELECT id FROM characters WHERE sessionId = ?').all(id2) as { id: string }[];
    const ids1 = new Set(chars1.map(c => c.id));
    for (const c of chars2) {
      expect(ids1.has(c.id)).toBe(false);
    }
  });
});
