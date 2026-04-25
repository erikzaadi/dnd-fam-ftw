import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StateService } from './stateService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-test-${Date.now()}.sqlite`);

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.LOCAL_IMAGE_STORAGE_PATH = path.join(os.tmpdir(), `dnd-test-imgs-state-${Date.now()}`);
  process.env.LOCAL_IMAGE_PUBLIC_BASE_URL = '/test-images';
  process.env.IMAGE_STORAGE_PROVIDER = 'local';
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1';
  process.env.OPENAI_API_KEY = 'test-invalid-key';
  StateService.initialize();
});

afterAll(() => {
  try {
    fs.unlinkSync(DB_PATH);
  } catch {
    // ignore
  }
});

function getTestDb() {
  return (StateService as unknown as { db: import('libsql').Database }).db;
}

function insertTestSession(id: string, namespaceId: string = 'local', displayName: string = 'Test World') {
  getTestDb().prepare(
    'INSERT INTO sessions (id, scene, sceneId, worldDescription, turn, tone, displayName, difficulty, gameMode, useLocalAI, savingsMode, namespace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, 'A Dark Cave', 'cave-1', 'A world of shadows', 1, 'thrilling adventure', displayName, 'normal', 'balanced', 0, 0, namespaceId);
}

function insertTestCharacter(charId: string, sessionId: string, name: string, hp: number = 10) {
  getTestDb().prepare(
    'INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(charId, sessionId, name, 'Rogue', 'Halfling', 'Sneaky', hp, 10, 2, 1, 3, 'active');
}

describe('StateService - Session CRUD', () => {
  it('getSession returns undefined for unknown ID', async () => {
    expect(await StateService.getSession('no-such-session')).toBeUndefined();
  });

  it('getSession returns session with correct fields', async () => {
    insertTestSession('sess-read', 'local', 'Shadow Realm');
    const session = await StateService.getSession('sess-read');
    expect(session).toBeDefined();
    expect(session!.id).toBe('sess-read');
    expect(session!.displayName).toBe('Shadow Realm');
    expect(session!.scene).toBe('A Dark Cave');
    expect(session!.party).toHaveLength(0);
  });

  it('getSession includes characters with inventory', async () => {
    insertTestSession('sess-chars', 'local', 'Goblin Den');
    insertTestCharacter('char-a', 'sess-chars', 'Pip');
    getTestDb().prepare(
      'INSERT INTO inventory (characterId, itemId, name, description, healValue, consumable, transferable) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('char-a', 'item-1', 'Healing Potion', 'Restores HP', 3, 1, 1);
    const session = await StateService.getSession('sess-chars');
    expect(session!.party).toHaveLength(1);
    expect(session!.party[0].name).toBe('Pip');
    expect(session!.party[0].inventory).toHaveLength(1);
    expect(session!.party[0].inventory[0].name).toBe('Healing Potion');
    expect(session!.party[0].inventory[0].healValue).toBe(3);
  });

  it('updateSession persists scene, turn, HP, and inventory', async () => {
    insertTestSession('sess-update', 'local', 'Dragon Lair');
    let session = await StateService.getSession('sess-update');
    session = {
      ...session!,
      scene: 'Updated Scene',
      turn: 5,
      party: [{
        id: 'char-upd', name: 'Zomgush', class: 'Barbarian', species: 'Orc', quirk: 'Loud',
        hp: 7, max_hp: 12, status: 'active' as const, stats: { might: 4, magic: 1, mischief: 2 },
        inventory: [{ id: 'axe-1', name: 'Battle Axe', description: 'Heavy', consumable: false, transferable: true }],
      }],
      activeCharacterId: 'char-upd',
    };
    await StateService.updateSession('sess-update', session);
    const reloaded = await StateService.getSession('sess-update');
    expect(reloaded!.scene).toBe('Updated Scene');
    expect(reloaded!.turn).toBe(5);
    expect(reloaded!.party[0].hp).toBe(7);
    expect(reloaded!.party[0].inventory[0].name).toBe('Battle Axe');
  });

  it('listSessions is scoped to namespace', async () => {
    insertTestSession('sess-ns-a', 'local', 'Local World');
    const { namespaceId: otherNs } = StateService.createUser('list-ns-test@test.com');
    insertTestSession('sess-ns-b', otherNs, 'Other Namespace World');
    const localSessions = await StateService.listSessions('local');
    const ids = localSessions.map(s => s.id);
    expect(ids).toContain('sess-ns-a');
    expect(ids).not.toContain('sess-ns-b');
    const otherSessions = await StateService.listSessions(otherNs);
    expect(otherSessions.some(s => s.id === 'sess-ns-b')).toBe(true);
  });

  it('addTurnResult and getTurnHistory round-trip', async () => {
    insertTestSession('sess-turns', 'local', 'Turn World');
    insertTestCharacter('char-t1', 'sess-turns', 'Archer');
    const turnId = await StateService.addTurnResult('sess-turns', {
      narration: 'The hero attacks!',
      rollNarration: 'A solid blow.',
      imagePrompt: 'hero attacking goblin',
      imageSuggested: false,
      imageUrl: null,
      choices: [
        { label: 'Advance', difficulty: 'easy', stat: 'might' },
        { label: 'Retreat', difficulty: 'normal', stat: 'mischief', difficultyValue: 10 },
      ],
      lastAction: {
        actionAttempt: 'Strike the goblin',
        actionResult: { success: true, roll: 15, statUsed: 'might', statBonus: 2, difficultyTarget: 12 },
      },
      turnType: 'normal',
    }, 'char-t1');
    expect(turnId).toBeTruthy();
    const history = await StateService.getTurnHistory('sess-turns');
    expect(history).toHaveLength(1);
    expect(history[0].narration).toBe('The hero attacks!');
    expect(history[0].rollNarration).toBe('A solid blow.');
    expect(history[0].choices).toHaveLength(2);
    expect(history[0].choices.find(c => c.label === 'Retreat')?.difficultyValue).toBe(10);
    expect(history[0].lastAction?.actionResult.statBonus).toBe(2);
  });

  it('deleteSession cascades to turn history', async () => {
    insertTestSession('sess-del', 'local', 'Doomed World');
    await StateService.addTurnResult('sess-del', {
      narration: 'Final turn.', imagePrompt: null, imageSuggested: false, imageUrl: null,
      choices: [], lastAction: null, turnType: 'normal',
    }, null);
    await StateService.deleteSession('sess-del');
    expect(await StateService.getSession('sess-del')).toBeUndefined();
    expect(await StateService.getTurnHistory('sess-del')).toHaveLength(0);
  });

  it('updateLatestTurnImage updates only the most recent turn', async () => {
    insertTestSession('sess-img-update', 'local', 'Image World');
    await StateService.addTurnResult('sess-img-update', {
      narration: 'First turn.', imagePrompt: 'a forest', imageSuggested: true, imageUrl: null,
      choices: [], lastAction: null, turnType: 'normal',
    }, null);
    await StateService.addTurnResult('sess-img-update', {
      narration: 'Second turn.', imagePrompt: 'a cave', imageSuggested: true, imageUrl: null,
      choices: [], lastAction: null, turnType: 'normal',
    }, null);
    await StateService.updateLatestTurnImage('sess-img-update', 'http://example.com/img.png', 'img-key-123', 'local');
    const history = await StateService.getTurnHistory('sess-img-update');
    expect(history[history.length - 1].imageUrl).toBe('http://example.com/img.png');
    expect(history[0].imageUrl).toBeNull();
  });
});

describe('StateService - User / Namespace management', () => {
  it('createUser + getUserByEmail round-trip', () => {
    const { userId, namespaceId } = StateService.createUser('hero@example.com');
    expect(userId).toBeTruthy();
    expect(namespaceId).toBeTruthy();
    const user = StateService.getUserByEmail('hero@example.com');
    expect(user).not.toBeNull();
    expect(user!.email).toBe('hero@example.com');
    expect(user!.namespace_id).toBe(namespaceId);
  });

  it('getUserByEmail returns null for unknown email', () => {
    expect(StateService.getUserByEmail('nobody@nowhere.com')).toBeNull();
  });

  it('deleteUser removes user', () => {
    StateService.createUser('todelete@example.com');
    expect(StateService.deleteUser('todelete@example.com')).toBe(true);
    expect(StateService.getUserByEmail('todelete@example.com')).toBeNull();
  });

  it('deleteUser returns false for unknown email', () => {
    expect(StateService.deleteUser('ghost@example.com')).toBe(false);
  });

  it('ensureAdminUser creates admin with role=admin and is idempotent', () => {
    StateService.ensureAdminUser('admin@example.com');
    const admin = StateService.getUserByEmail('admin@example.com');
    expect(admin).not.toBeNull();
    expect(admin!.role).toBe('admin');
    StateService.ensureAdminUser('admin@example.com');
    expect(StateService.getUserByEmail('admin@example.com')!.id).toBe(admin!.id);
  });

  it('listUsers returns user with namespace info', () => {
    StateService.createUser('list-test@example.com');
    const users = StateService.listUsers();
    const found = users.find(u => u.email === 'list-test@example.com');
    expect(found).toBeDefined();
    expect(found!.namespace_name).toBeTruthy();
    expect(found!.namespaces?.length).toBeGreaterThan(0);
  });

  it('createNamespace + getNamespaceById', () => {
    const { namespaceId } = StateService.createNamespace('The Guild');
    const ns = StateService.getNamespaceById(namespaceId);
    expect(ns).not.toBeNull();
    expect(ns!.name).toBe('The Guild');
  });

  it('getNamespaceById returns null for unknown ID', () => {
    expect(StateService.getNamespaceById('no-such-ns')).toBeNull();
  });

  it('renameNamespace updates name', () => {
    const { namespaceId } = StateService.createNamespace('Old Name');
    expect(StateService.renameNamespace(namespaceId, 'New Name')).toBe(true);
    expect(StateService.getNamespaceById(namespaceId)!.name).toBe('New Name');
  });

  it('deleteNamespace rejects the local namespace', () => {
    expect(StateService.deleteNamespace('local').ok).toBe(false);
  });

  it('deleteNamespace rejects namespace with users', () => {
    const { namespaceId } = StateService.createUser('has-users@example.com');
    const result = StateService.deleteNamespace(namespaceId);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/user/);
  });

  it('addUserToNamespace + getUserNamespaces + removeUserFromNamespace', () => {
    const { namespaceId: primaryNs } = StateService.createUser('multi-ns@example.com');
    const { namespaceId: secondNs } = StateService.createNamespace('Second Realm');
    expect(StateService.addUserToNamespace('multi-ns@example.com', secondNs).ok).toBe(true);
    const nsIds = StateService.getUserNamespaces('multi-ns@example.com').map(n => n.id);
    expect(nsIds).toContain(primaryNs);
    expect(nsIds).toContain(secondNs);
    expect(StateService.removeUserFromNamespace('multi-ns@example.com', secondNs).ok).toBe(true);
    expect(StateService.getUserNamespaces('multi-ns@example.com').some(n => n.id === secondNs)).toBe(false);
  });

  it('removeUserFromNamespace rejects primary namespace', () => {
    const { namespaceId } = StateService.createUser('primary-ns@example.com');
    const result = StateService.removeUserFromNamespace('primary-ns@example.com', namespaceId);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/primary/);
  });

  it('setPrimaryNamespace changes primary namespace', () => {
    const { namespaceId: primaryNs } = StateService.createUser('switch-ns@example.com');
    const { namespaceId: newPrimaryNs } = StateService.createNamespace('New Primary');
    StateService.addUserToNamespace('switch-ns@example.com', newPrimaryNs);
    expect(StateService.setPrimaryNamespace('switch-ns@example.com', newPrimaryNs).ok).toBe(true);
    expect(StateService.getUserByEmail('switch-ns@example.com')!.namespace_id).toBe(newPrimaryNs);
    expect(StateService.getUserNamespaces('switch-ns@example.com').some(n => n.id === primaryNs)).toBe(true);
  });
});

describe('StateService - Namespace limits', () => {
  it('setNamespaceLimits + getNamespaceLimits', () => {
    const { namespaceId } = StateService.createNamespace('Limited Realm');
    const before = StateService.getNamespaceLimits(namespaceId);
    expect(before.maxSessions).toBeNull();
    expect(before.maxTurns).toBeNull();
    expect(StateService.setNamespaceLimits(namespaceId, 5, 100)).toBe(true);
    const after = StateService.getNamespaceLimits(namespaceId);
    expect(after.maxSessions).toBe(5);
    expect(after.maxTurns).toBe(100);
    StateService.setNamespaceLimits(namespaceId, null, null);
    const removed = StateService.getNamespaceLimits(namespaceId);
    expect(removed.maxSessions).toBeNull();
    expect(removed.maxTurns).toBeNull();
  });

  it('countSessionsInNamespace', () => {
    const { namespaceId } = StateService.createNamespace('Count Realm');
    expect(StateService.countSessionsInNamespace(namespaceId)).toBe(0);
    insertTestSession('sess-count-1', namespaceId);
    insertTestSession('sess-count-2', namespaceId);
    expect(StateService.countSessionsInNamespace(namespaceId)).toBe(2);
  });
});

describe('StateService - Invite requests', () => {
  it('addInviteRequest + hasInviteRequest, duplicate ignored', () => {
    expect(StateService.hasInviteRequest('newbie@example.com')).toBe(false);
    StateService.addInviteRequest('newbie@example.com', 'Please let me in!');
    expect(StateService.hasInviteRequest('newbie@example.com')).toBe(true);
    StateService.addInviteRequest('newbie@example.com', 'Again!');
    const all = StateService.listInviteRequests().filter(r => r.email === 'newbie@example.com');
    expect(all).toHaveLength(1);
    expect(all[0].message).toBe('Please let me in!');
  });

  it('clearInviteRequests removes all', () => {
    StateService.addInviteRequest('a@example.com');
    StateService.addInviteRequest('b@example.com');
    const count = StateService.clearInviteRequests();
    expect(count).toBeGreaterThan(0);
    expect(StateService.listInviteRequests()).toHaveLength(0);
  });
});

describe('StateService - Character history', () => {
  it('getCharacterTurnHistory returns turns scoped to character', async () => {
    insertTestSession('sess-char-hist', 'local', 'History World');
    insertTestCharacter('char-hist-1', 'sess-char-hist', 'Bard');
    insertTestCharacter('char-hist-2', 'sess-char-hist', 'Wizard');
    await StateService.addTurnResult('sess-char-hist', {
      narration: 'Bard plays a tune.', imagePrompt: null, imageSuggested: false, imageUrl: null,
      choices: [], lastAction: { actionAttempt: 'Play lute', actionResult: { success: true, roll: 14, statUsed: 'magic' } },
      turnType: 'normal',
    }, 'char-hist-1');
    await StateService.addTurnResult('sess-char-hist', {
      narration: 'Wizard casts fireball.', imagePrompt: null, imageSuggested: false, imageUrl: null,
      choices: [], lastAction: { actionAttempt: 'Cast fireball', actionResult: { success: true, roll: 18, statUsed: 'magic' } },
      turnType: 'normal',
    }, 'char-hist-2');
    const bardHistory = StateService.getCharacterTurnHistory('char-hist-1');
    expect(bardHistory).toHaveLength(1);
    expect(bardHistory[0].narration).toBe('Bard plays a tune.');
    expect(bardHistory[0].actionAttempt).toBe('Play lute');
    expect(StateService.getCharacterTurnHistory('char-hist-2')).toHaveLength(1);
  });

  it('updateStorySummary persists summary', async () => {
    insertTestSession('sess-summary', 'local', 'Summary World');
    await StateService.updateStorySummary('sess-summary', 'The party defeated the goblin king.');
    const session = await StateService.getSession('sess-summary');
    expect(session!.storySummary).toBe('The party defeated the goblin king.');
  });
});
