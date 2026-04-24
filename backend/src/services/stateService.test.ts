import os from 'os';
import path from 'path';
import fs from 'fs';
import { StateService } from './stateService.js';

// Set env vars before any StateService method is called.
// getConfig() is lazily cached - these are picked up on first use.
const DB_PATH = path.join(os.tmpdir(), `dnd-test-${Date.now()}.sqlite`);
process.env.SQLITE_DB_PATH = DB_PATH;
process.env.LOCAL_IMAGE_STORAGE_PATH = path.join(os.tmpdir(), `dnd-test-imgs-state-${Date.now()}`);
process.env.LOCAL_IMAGE_PUBLIC_BASE_URL = '/test-images';
process.env.IMAGE_STORAGE_PROVIDER = 'local';
// Make AI calls fail fast (connection refused) so createSession falls back to 'A New World'.
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1';
process.env.OPENAI_API_KEY = 'test-invalid-key';

// Helper: direct DB access for test data insertion (bypasses AI calls in createSession).
// StateService.initialize() must be called first to run migrations.
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

console.log('Testing StateService (integration)...');

// Initialize DB and run migrations
StateService.initialize();
console.log(`Using temp DB: ${DB_PATH}`);

// ── Session CRUD ──────────────────────────────────────────────────────────────

// Test 1: getSession returns undefined for unknown ID
console.log('Test 1: getSession returns undefined for unknown ID...');
{
  const result = await StateService.getSession('no-such-session');
  if (result !== undefined) {
    throw new Error(`Expected undefined, got ${JSON.stringify(result)}`);
  }
  console.log('- Returns undefined for unknown session ✓');
}

// Test 2: getSession returns session with correct fields
console.log('Test 2: getSession returns session data...');
{
  insertTestSession('sess-read', 'local', 'Shadow Realm');
  const session = await StateService.getSession('sess-read');
  if (!session) {
    throw new Error('Expected a session');
  }
  if (session.id !== 'sess-read') {
    throw new Error(`id mismatch: ${session.id}`);
  }
  if (session.displayName !== 'Shadow Realm') {
    throw new Error(`displayName mismatch: ${session.displayName}`);
  }
  if (session.scene !== 'A Dark Cave') {
    throw new Error(`scene mismatch: ${session.scene}`);
  }
  if (session.party.length !== 0) {
    throw new Error(`Expected empty party, got ${session.party.length}`);
  }
  console.log(`- Session loaded: displayName='${session.displayName}', scene='${session.scene}' ✓`);
}

// Test 3: getSession maps characters + inventory correctly
console.log('Test 3: getSession includes characters with inventory...');
{
  insertTestSession('sess-chars', 'local', 'Goblin Den');
  insertTestCharacter('char-a', 'sess-chars', 'Pip');
  getTestDb().prepare(
    'INSERT INTO inventory (characterId, itemId, name, description, healValue, consumable, transferable) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('char-a', 'item-1', 'Healing Potion', 'Restores HP', 3, 1, 1);
  const session = await StateService.getSession('sess-chars');
  if (!session) {
    throw new Error('Session not found');
  }
  if (session.party.length !== 1) {
    throw new Error(`Expected 1 character, got ${session.party.length}`);
  }
  const char = session.party[0];
  if (char.name !== 'Pip') {
    throw new Error(`name mismatch: ${char.name}`);
  }
  if (char.inventory.length !== 1) {
    throw new Error(`Expected 1 inventory item, got ${char.inventory.length}`);
  }
  if (char.inventory[0].name !== 'Healing Potion') {
    throw new Error(`item name mismatch: ${char.inventory[0].name}`);
  }
  if (char.inventory[0].healValue !== 3) {
    throw new Error(`healValue mismatch: ${char.inventory[0].healValue}`);
  }
  console.log(`- Character '${char.name}' with '${char.inventory[0].name}' loaded ✓`);
}

// Test 4: updateSession persists character HP and inventory changes
console.log('Test 4: updateSession persists character state...');
{
  insertTestSession('sess-update', 'local', 'Dragon Lair');
  let session = await StateService.getSession('sess-update');
  if (!session) {
    throw new Error('Session not found');
  }
  session = {
    ...session,
    scene: 'Updated Scene',
    turn: 5,
    party: [
      {
        id: 'char-upd',
        name: 'Zomgush',
        class: 'Barbarian',
        species: 'Orc',
        quirk: 'Loud',
        hp: 7,
        max_hp: 12,
        status: 'active' as const,
        stats: { might: 4, magic: 1, mischief: 2 },
        inventory: [
          { id: 'axe-1', name: 'Battle Axe', description: 'Heavy', consumable: false, transferable: true },
        ],
      },
    ],
    activeCharacterId: 'char-upd',
  };
  await StateService.updateSession('sess-update', session);
  const reloaded = await StateService.getSession('sess-update');
  if (!reloaded) {
    throw new Error('Session not found after update');
  }
  if (reloaded.scene !== 'Updated Scene') {
    throw new Error(`scene not persisted: ${reloaded.scene}`);
  }
  if (reloaded.turn !== 5) {
    throw new Error(`turn not persisted: ${reloaded.turn}`);
  }
  if (reloaded.party.length !== 1) {
    throw new Error(`Expected 1 character after update, got ${reloaded.party.length}`);
  }
  if (reloaded.party[0].hp !== 7) {
    throw new Error(`hp not persisted: ${reloaded.party[0].hp}`);
  }
  if (reloaded.party[0].inventory.length !== 1) {
    throw new Error(`inventory not persisted`);
  }
  if (reloaded.party[0].inventory[0].name !== 'Battle Axe') {
    throw new Error(`item not persisted: ${reloaded.party[0].inventory[0].name}`);
  }
  console.log('- Scene, turn, HP, and inventory persisted correctly ✓');
}

// Test 5: listSessions scopes to namespace
console.log('Test 5: listSessions is scoped to namespace...');
{
  insertTestSession('sess-ns-a', 'local', 'Local World');
  const { namespaceId: otherNs } = StateService.createUser('list-ns-test@test.com');
  insertTestSession('sess-ns-b', otherNs, 'Other Namespace World');
  const localSessions = await StateService.listSessions('local');
  const ids = localSessions.map(s => s.id);
  if (!ids.includes('sess-ns-a')) {
    throw new Error(`Expected 'sess-ns-a' in local sessions`);
  }
  if (ids.includes('sess-ns-b')) {
    throw new Error(`'sess-ns-b' should not appear in local namespace`);
  }
  const otherSessions = await StateService.listSessions(otherNs);
  if (!otherSessions.some(s => s.id === 'sess-ns-b')) {
    throw new Error(`Expected 'sess-ns-b' in other namespace`);
  }
  console.log('- Sessions correctly scoped to namespace ✓');
}

// Test 6: addTurnResult and getTurnHistory round-trip
console.log('Test 6: addTurnResult + getTurnHistory...');
{
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
  if (!turnId) {
    throw new Error('Expected a turn ID');
  }
  const history = await StateService.getTurnHistory('sess-turns');
  if (history.length !== 1) {
    throw new Error(`Expected 1 turn, got ${history.length}`);
  }
  const turn = history[0];
  if (turn.narration !== 'The hero attacks!') {
    throw new Error(`narration mismatch: ${turn.narration}`);
  }
  if (turn.rollNarration !== 'A solid blow.') {
    throw new Error(`rollNarration mismatch: ${turn.rollNarration}`);
  }
  if (turn.choices.length !== 2) {
    throw new Error(`Expected 2 choices, got ${turn.choices.length}`);
  }
  const choiceWithValue = turn.choices.find(c => c.label === 'Retreat');
  if (!choiceWithValue || choiceWithValue.difficultyValue !== 10) {
    throw new Error(`difficultyValue not persisted: ${JSON.stringify(choiceWithValue)}`);
  }
  if (!turn.lastAction || !turn.lastAction.actionResult.success) {
    throw new Error('lastAction not persisted correctly');
  }
  if (turn.lastAction.actionResult.statBonus !== 2) {
    throw new Error(`statBonus not persisted: ${turn.lastAction.actionResult.statBonus}`);
  }
  console.log(`- Turn ${turnId} persisted with narration, choices, and action details ✓`);
}

// Test 7: deleteSession removes session and cascades to turn history
console.log('Test 7: deleteSession cascades to turn history...');
{
  insertTestSession('sess-del', 'local', 'Doomed World');
  await StateService.addTurnResult('sess-del', {
    narration: 'Final turn.',
    imagePrompt: null,
    imageSuggested: false,
    imageUrl: null,
    choices: [],
    lastAction: null,
    turnType: 'normal',
  }, null);
  await StateService.deleteSession('sess-del');
  const gone = await StateService.getSession('sess-del');
  if (gone !== undefined) {
    throw new Error('Session should be deleted');
  }
  const history = await StateService.getTurnHistory('sess-del');
  if (history.length !== 0) {
    throw new Error(`Turn history should be empty after delete, got ${history.length}`);
  }
  console.log('- Session and turn history deleted ✓');
}

// Test 8: updateLatestTurnImage updates only the most recent turn
console.log('Test 8: updateLatestTurnImage updates most recent turn...');
{
  insertTestSession('sess-img-update', 'local', 'Image World');
  await StateService.addTurnResult('sess-img-update', {
    narration: 'First turn.',
    imagePrompt: 'a forest',
    imageSuggested: true,
    imageUrl: null,
    choices: [],
    lastAction: null,
    turnType: 'normal',
  }, null);
  await StateService.addTurnResult('sess-img-update', {
    narration: 'Second turn.',
    imagePrompt: 'a cave',
    imageSuggested: true,
    imageUrl: null,
    choices: [],
    lastAction: null,
    turnType: 'normal',
  }, null);
  await StateService.updateLatestTurnImage('sess-img-update', 'http://example.com/img.png', 'img-key-123', 'local');
  const history = await StateService.getTurnHistory('sess-img-update');
  const lastTurn = history[history.length - 1];
  if (lastTurn.imageUrl !== 'http://example.com/img.png') {
    throw new Error(`Latest turn imageUrl mismatch: ${lastTurn.imageUrl}`);
  }
  const firstTurn = history[0];
  if (firstTurn.imageUrl !== null) {
    throw new Error(`First turn imageUrl should still be null, got: ${firstTurn.imageUrl}`);
  }
  console.log('- Latest turn image updated, first turn unchanged ✓');
}

// ── User / Namespace management ───────────────────────────────────────────────

// Test 9: createUser creates user + namespace, getUserByEmail retrieves them
console.log('Test 9: createUser + getUserByEmail...');
{
  const { userId, namespaceId } = StateService.createUser('hero@example.com');
  if (!userId || !namespaceId) {
    throw new Error('Expected userId and namespaceId');
  }
  const user = StateService.getUserByEmail('hero@example.com');
  if (!user) {
    throw new Error('User not found');
  }
  if (user.email !== 'hero@example.com') {
    throw new Error(`email mismatch: ${user.email}`);
  }
  if (user.namespace_id !== namespaceId) {
    throw new Error(`namespace_id mismatch: ${user.namespace_id}`);
  }
  console.log(`- User created: userId=${userId}, namespaceId=${namespaceId} ✓`);
}

// Test 10: getUserByEmail returns null for unknown email
console.log('Test 10: getUserByEmail returns null for unknown email...');
{
  const result = StateService.getUserByEmail('nobody@nowhere.com');
  if (result !== null) {
    throw new Error('Expected null for unknown email');
  }
  console.log('- Returns null for unknown email ✓');
}

// Test 11: deleteUser removes user and orphan namespace
console.log('Test 11: deleteUser removes user and orphan namespace...');
{
  StateService.createUser('todelete@example.com');
  const deleted = StateService.deleteUser('todelete@example.com');
  if (!deleted) {
    throw new Error('deleteUser should return true');
  }
  const gone = StateService.getUserByEmail('todelete@example.com');
  if (gone !== null) {
    throw new Error('User should be gone after delete');
  }
  console.log('- User deleted ✓');
}

// Test 12: deleteUser returns false for unknown email
console.log('Test 12: deleteUser returns false for unknown email...');
{
  const result = StateService.deleteUser('ghost@example.com');
  if (result !== false) {
    throw new Error('Expected false for unknown email');
  }
  console.log('- Returns false for unknown email ✓');
}

// Test 13: ensureAdminUser creates admin if not found
console.log('Test 13: ensureAdminUser creates admin user...');
{
  StateService.ensureAdminUser('admin@example.com');
  const admin = StateService.getUserByEmail('admin@example.com');
  if (!admin) {
    throw new Error('Admin user not created');
  }
  if (admin.role !== 'admin') {
    throw new Error(`Expected role 'admin', got '${admin.role}'`);
  }
  // Calling again should be idempotent
  StateService.ensureAdminUser('admin@example.com');
  const adminAgain = StateService.getUserByEmail('admin@example.com');
  if (!adminAgain || adminAgain.id !== admin.id) {
    throw new Error('Second ensureAdminUser changed the user');
  }
  console.log(`- Admin user created with role='${admin.role}', idempotent ✓`);
}

// Test 14: listUsers returns user with namespace info
console.log('Test 14: listUsers returns user with namespace info...');
{
  StateService.createUser('list-test@example.com');
  const users = StateService.listUsers();
  const found = users.find(u => u.email === 'list-test@example.com');
  if (!found) {
    throw new Error('User not found in listUsers');
  }
  if (!found.namespace_name) {
    throw new Error('namespace_name should be set');
  }
  if (!found.namespaces || found.namespaces.length === 0) {
    throw new Error('namespaces array should be non-empty');
  }
  console.log(`- User listed with namespace_name='${found.namespace_name}' ✓`);
}

// Test 15: createNamespace + getNamespaceById
console.log('Test 15: createNamespace + getNamespaceById...');
{
  const { namespaceId } = StateService.createNamespace('The Guild');
  const ns = StateService.getNamespaceById(namespaceId);
  if (!ns) {
    throw new Error('Namespace not found');
  }
  if (ns.name !== 'The Guild') {
    throw new Error(`name mismatch: ${ns.name}`);
  }
  console.log(`- Namespace created: id=${namespaceId}, name='${ns.name}' ✓`);
}

// Test 16: getNamespaceById returns null for unknown ID
console.log('Test 16: getNamespaceById returns null for unknown ID...');
{
  const ns = StateService.getNamespaceById('no-such-ns');
  if (ns !== null) {
    throw new Error('Expected null for unknown namespace');
  }
  console.log('- Returns null for unknown namespace ✓');
}

// Test 17: renameNamespace updates name
console.log('Test 17: renameNamespace updates name...');
{
  const { namespaceId } = StateService.createNamespace('Old Name');
  const ok = StateService.renameNamespace(namespaceId, 'New Name');
  if (!ok) {
    throw new Error('renameNamespace should return true');
  }
  const ns = StateService.getNamespaceById(namespaceId);
  if (!ns || ns.name !== 'New Name') {
    throw new Error(`Name not updated: ${ns?.name}`);
  }
  console.log(`- Namespace renamed to '${ns.name}' ✓`);
}

// Test 18: deleteNamespace rejects 'local'
console.log('Test 18: deleteNamespace rejects the local namespace...');
{
  const result = StateService.deleteNamespace('local');
  if (result.ok) {
    throw new Error('Should not allow deleting local namespace');
  }
  console.log(`- Rejected with: '${result.reason}' ✓`);
}

// Test 19: deleteNamespace rejects namespace with users
console.log('Test 19: deleteNamespace rejects namespace with users...');
{
  const { namespaceId } = StateService.createUser('has-users@example.com');
  const result = StateService.deleteNamespace(namespaceId);
  if (result.ok) {
    throw new Error('Should not allow deleting namespace that has users');
  }
  if (!result.reason?.includes('user')) {
    throw new Error(`Expected user-related reason, got: '${result.reason}'`);
  }
  console.log(`- Rejected with: '${result.reason}' ✓`);
}

// Test 20: addUserToNamespace + getUserNamespaces + removeUserFromNamespace
console.log('Test 20: addUserToNamespace + getUserNamespaces + removeUserFromNamespace...');
{
  const { namespaceId: primaryNs } = StateService.createUser('multi-ns@example.com');
  const { namespaceId: secondNs } = StateService.createNamespace('Second Realm');
  const addResult = StateService.addUserToNamespace('multi-ns@example.com', secondNs);
  if (!addResult.ok) {
    throw new Error(`addUserToNamespace failed: ${addResult.reason}`);
  }
  const namespaces = StateService.getUserNamespaces('multi-ns@example.com');
  const nsIds = namespaces.map(n => n.id);
  if (!nsIds.includes(primaryNs)) {
    throw new Error('Primary namespace not in user namespaces');
  }
  if (!nsIds.includes(secondNs)) {
    throw new Error('Second namespace not added to user namespaces');
  }
  const removeResult = StateService.removeUserFromNamespace('multi-ns@example.com', secondNs);
  if (!removeResult.ok) {
    throw new Error(`removeUserFromNamespace failed: ${removeResult.reason}`);
  }
  const afterRemove = StateService.getUserNamespaces('multi-ns@example.com');
  if (afterRemove.some(n => n.id === secondNs)) {
    throw new Error('Namespace should have been removed');
  }
  console.log('- Namespace added, found, and removed from user ✓');
}

// Test 21: removeUserFromNamespace rejects removing primary namespace
console.log('Test 21: removeUserFromNamespace rejects primary namespace...');
{
  const { namespaceId } = StateService.createUser('primary-ns@example.com');
  const result = StateService.removeUserFromNamespace('primary-ns@example.com', namespaceId);
  if (result.ok) {
    throw new Error('Should not allow removing user from their primary namespace');
  }
  if (!result.reason?.includes('primary')) {
    throw new Error(`Expected 'primary' in reason, got: '${result.reason}'`);
  }
  console.log(`- Rejected with: '${result.reason}' ✓`);
}

// Test 22: setPrimaryNamespace changes primary namespace
console.log('Test 22: setPrimaryNamespace changes primary namespace...');
{
  const { namespaceId: primaryNs } = StateService.createUser('switch-ns@example.com');
  const { namespaceId: newPrimaryNs } = StateService.createNamespace('New Primary');
  StateService.addUserToNamespace('switch-ns@example.com', newPrimaryNs);
  const result = StateService.setPrimaryNamespace('switch-ns@example.com', newPrimaryNs);
  if (!result.ok) {
    throw new Error(`setPrimaryNamespace failed: ${result.reason}`);
  }
  const user = StateService.getUserByEmail('switch-ns@example.com');
  if (!user || user.namespace_id !== newPrimaryNs) {
    throw new Error(`Primary namespace not updated. Got: ${user?.namespace_id}`);
  }
  // Old primary should still be accessible in user_namespaces
  const namespaces = StateService.getUserNamespaces('switch-ns@example.com');
  if (!namespaces.some(n => n.id === primaryNs)) {
    throw new Error('Old primary namespace should still be in user namespaces');
  }
  console.log('- Primary namespace switched successfully ✓');
}

// ── Namespace limits ──────────────────────────────────────────────────────────

// Test 23: setNamespaceLimits + getNamespaceLimits
console.log('Test 23: setNamespaceLimits + getNamespaceLimits...');
{
  const { namespaceId } = StateService.createNamespace('Limited Realm');
  const before = StateService.getNamespaceLimits(namespaceId);
  if (before.maxSessions !== null || before.maxTurns !== null) {
    throw new Error('Limits should default to null');
  }
  const ok = StateService.setNamespaceLimits(namespaceId, 5, 100);
  if (!ok) {
    throw new Error('setNamespaceLimits should return true');
  }
  const after = StateService.getNamespaceLimits(namespaceId);
  if (after.maxSessions !== 5) {
    throw new Error(`maxSessions mismatch: ${after.maxSessions}`);
  }
  if (after.maxTurns !== 100) {
    throw new Error(`maxTurns mismatch: ${after.maxTurns}`);
  }
  // Remove limits
  StateService.setNamespaceLimits(namespaceId, null, null);
  const removed = StateService.getNamespaceLimits(namespaceId);
  if (removed.maxSessions !== null || removed.maxTurns !== null) {
    throw new Error('Limits should be null after removal');
  }
  console.log('- Limits set, read, and removed correctly ✓');
}

// Test 24: countSessionsInNamespace
console.log('Test 24: countSessionsInNamespace...');
{
  const { namespaceId } = StateService.createNamespace('Count Realm');
  const before = StateService.countSessionsInNamespace(namespaceId);
  if (before !== 0) {
    throw new Error(`Expected 0 sessions, got ${before}`);
  }
  insertTestSession('sess-count-1', namespaceId);
  insertTestSession('sess-count-2', namespaceId);
  const after = StateService.countSessionsInNamespace(namespaceId);
  if (after !== 2) {
    throw new Error(`Expected 2 sessions, got ${after}`);
  }
  console.log(`- countSessionsInNamespace: ${after} ✓`);
}

// ── Invite requests ───────────────────────────────────────────────────────────

// Test 25: addInviteRequest + hasInviteRequest
console.log('Test 25: addInviteRequest + hasInviteRequest...');
{
  if (StateService.hasInviteRequest('newbie@example.com')) {
    throw new Error('Should not have invite request yet');
  }
  StateService.addInviteRequest('newbie@example.com', 'Please let me in!');
  if (!StateService.hasInviteRequest('newbie@example.com')) {
    throw new Error('Invite request should exist after adding');
  }
  // Duplicate is ignored (INSERT OR IGNORE)
  StateService.addInviteRequest('newbie@example.com', 'Again!');
  const all = StateService.listInviteRequests();
  const found = all.filter(r => r.email === 'newbie@example.com');
  if (found.length !== 1) {
    throw new Error(`Expected exactly 1 invite request, got ${found.length}`);
  }
  if (found[0].message !== 'Please let me in!') {
    throw new Error(`message mismatch: ${found[0].message}`);
  }
  console.log('- Invite request added, duplicate ignored ✓');
}

// Test 26: clearInviteRequests removes all
console.log('Test 26: clearInviteRequests removes all...');
{
  StateService.addInviteRequest('a@example.com');
  StateService.addInviteRequest('b@example.com');
  const count = StateService.clearInviteRequests();
  if (count === 0) {
    throw new Error('clearInviteRequests should return count of deleted rows');
  }
  const remaining = StateService.listInviteRequests();
  if (remaining.length !== 0) {
    throw new Error(`Expected 0 invite requests after clear, got ${remaining.length}`);
  }
  console.log(`- Cleared ${count} invite requests ✓`);
}

// ── Character history ─────────────────────────────────────────────────────────

// Test 27: getCharacterTurnHistory returns turns for a specific character
console.log('Test 27: getCharacterTurnHistory returns character turns...');
{
  insertTestSession('sess-char-hist', 'local', 'History World');
  insertTestCharacter('char-hist-1', 'sess-char-hist', 'Bard');
  insertTestCharacter('char-hist-2', 'sess-char-hist', 'Wizard');
  await StateService.addTurnResult('sess-char-hist', {
    narration: 'Bard plays a tune.',
    imagePrompt: null,
    imageSuggested: false,
    imageUrl: null,
    choices: [],
    lastAction: { actionAttempt: 'Play lute', actionResult: { success: true, roll: 14, statUsed: 'magic' } },
    turnType: 'normal',
  }, 'char-hist-1');
  await StateService.addTurnResult('sess-char-hist', {
    narration: 'Wizard casts fireball.',
    imagePrompt: null,
    imageSuggested: false,
    imageUrl: null,
    choices: [],
    lastAction: { actionAttempt: 'Cast fireball', actionResult: { success: true, roll: 18, statUsed: 'magic' } },
    turnType: 'normal',
  }, 'char-hist-2');
  const bardHistory = StateService.getCharacterTurnHistory('char-hist-1');
  if (bardHistory.length !== 1) {
    throw new Error(`Expected 1 turn for Bard, got ${bardHistory.length}`);
  }
  if (bardHistory[0].narration !== 'Bard plays a tune.') {
    throw new Error(`Bard narration mismatch: ${bardHistory[0].narration}`);
  }
  if (bardHistory[0].actionAttempt !== 'Play lute') {
    throw new Error(`Bard action mismatch: ${bardHistory[0].actionAttempt}`);
  }
  const wizardHistory = StateService.getCharacterTurnHistory('char-hist-2');
  if (wizardHistory.length !== 1) {
    throw new Error(`Expected 1 turn for Wizard, got ${wizardHistory.length}`);
  }
  console.log('- Character turn history correctly scoped to character ✓');
}

// Test 28: updateStorySummary persists summary
console.log('Test 28: updateStorySummary persists story summary...');
{
  insertTestSession('sess-summary', 'local', 'Summary World');
  await StateService.updateStorySummary('sess-summary', 'The party defeated the goblin king.');
  const session = await StateService.getSession('sess-summary');
  if (!session) {
    throw new Error('Session not found');
  }
  if (session.storySummary !== 'The party defeated the goblin king.') {
    throw new Error(`storySummary mismatch: '${session.storySummary}'`);
  }
  console.log('- Story summary persisted ✓');
}

// Cleanup temp DB
try {
  fs.unlinkSync(DB_PATH);
} catch {
  // Ignore cleanup errors
}

console.log('\nAll stateService integration tests passed!');
