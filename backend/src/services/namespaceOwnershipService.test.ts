import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { migrate } from '../persistence/migrations.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { applyProposedOwners, buildOwnershipReport, isNamespaceOwner, setNamespaceOwner } from './namespaceOwnershipService.js';
import { accountService } from '../services/accountService.js';
import { realmAccess } from '../realms/access.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-ownership-test-${Date.now()}.sqlite`);

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1';
  process.env.OPENAI_API_KEY = 'test-invalid-key';
  initializeDatabase();
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

// Simulates a namespace created before ownership existed.
const clearOwner = (namespaceId: string) => {
  getDb().prepare('UPDATE namespaces SET owner_user_id = NULL WHERE id = ?').run(namespaceId);
};

const reportFor = (namespaceId: string) => buildOwnershipReport().find(row => row.namespaceId === namespaceId);

describe('namespace ownership', () => {
  it('makes a new account the owner of its own namespace, but not of one it joins', () => {
    const owner = accountService.createUser('owner-a@example.com');
    expect(isNamespaceOwner(owner.userId, owner.namespaceId)).toBe(true);
    const joined = accountService.createUserInExistingNamespace('joiner-a@example.com', owner.namespaceId);
    expect(isNamespaceOwner(joined.userId, owner.namespaceId)).toBe(false);
    expect(reportFor(owner.namespaceId)?.status).toBe('ok');
  });

  it('keeps foreign keys on and refuses deleting an owner account row', () => {
    expect((getDb().prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    const owner = accountService.createUser('owner-fk@example.com');
    expect(() => getDb().prepare('DELETE FROM users WHERE id = ?').run(owner.userId)).toThrow(/FOREIGN KEY/);
  });

  it('proposes only a sole member who has the namespace as primary', () => {
    const solo = accountService.createUser('solo@example.com');
    clearOwner(solo.namespaceId);
    expect(reportFor(solo.namespaceId)).toMatchObject({ status: 'proposed', proposedOwner: { userId: solo.userId } });

    const shared = accountService.createUser('shared-1@example.com');
    accountService.createUserInExistingNamespace('shared-2@example.com', shared.namespaceId);
    clearOwner(shared.namespaceId);
    expect(reportFor(shared.namespaceId)).toMatchObject({ status: 'unresolved', proposedOwner: null });

    const { namespaceId: empty } = namespaceRepository.createNamespace('Empty realm');
    expect(reportFor(empty)).toMatchObject({ status: 'unresolved', reason: 'no members' });

    // A sole member whose primary namespace is elsewhere is not a safe guess.
    const guest = accountService.createUser('guest@example.com');
    const { namespaceId: visited } = namespaceRepository.createNamespace('Visited realm');
    realmAccess.addMember(guest.userId, visited);
    clearOwner(visited);
    expect(reportFor(visited)).toMatchObject({ status: 'unresolved', reason: 'sole member has a different primary namespace' });

    applyProposedOwners();
    expect(namespaceRepository.getOwnerUserId(solo.namespaceId)).toBe(solo.userId);
    expect(namespaceRepository.getOwnerUserId(shared.namespaceId)).toBeNull();
    expect(namespaceRepository.getOwnerUserId(visited)).toBeNull();
  });

  it('makes the first member of an empty realm its owner, and never replaces an owner', () => {
    const { namespaceId } = namespaceRepository.createNamespace('Fresh realm');
    const first = accountService.createUser('first-member@example.com');
    const second = accountService.createUser('second-member@example.com');
    realmAccess.addMember(first.userId, namespaceId);
    realmAccess.addMember(second.userId, namespaceId);
    expect(namespaceRepository.getOwnerUserId(namespaceId)).toBe(first.userId);
  });

  it('backfills owners for existing realms once: the primary member first, then the oldest member', () => {
    const db = getDb();
    const host = accountService.createUser('legacy-host@example.com');
    accountService.createUserInExistingNamespace('legacy-guest@example.com', host.namespaceId);
    // Timestamps have one-second resolution; make the guest clearly newer.
    db.prepare("UPDATE users SET created_at = '2030-01-01 00:00:00' WHERE email = 'legacy-guest@example.com'").run();
    const visitor = accountService.createUser('legacy-visitor@example.com');
    const { namespaceId: shared } = namespaceRepository.createNamespace('Legacy shared');
    realmAccess.addMember(visitor.userId, shared);
    const { namespaceId: empty } = namespaceRepository.createNamespace('Legacy empty');
    for (const id of [host.namespaceId, shared]) {
      clearOwner(id);
    }

    db.prepare("DELETE FROM applied_migrations WHERE name = 'assign_namespace_owners_from_primary'").run();
    migrate(db);

    // Two members share the primary realm: the one it was created for is older.
    expect(namespaceRepository.getOwnerUserId(host.namespaceId)).toBe(host.userId);
    // Nobody has it as primary: its (only, so oldest) member.
    expect(namespaceRepository.getOwnerUserId(shared)).toBe(visitor.userId);
    expect(namespaceRepository.getOwnerUserId(empty)).toBeNull();
    expect(namespaceRepository.getOwnerUserId('local')).toBeNull();

    // Once only: a later ownerless realm is not touched by re-running migrations.
    clearOwner(shared);
    migrate(db);
    expect(namespaceRepository.getOwnerUserId(shared)).toBeNull();
  });

  it('never lists the local namespace', () => {
    expect(reportFor('local')).toBeUndefined();
  });

  it('sets or transfers the owner only to a current member', () => {
    const first = accountService.createUser('transfer-1@example.com');
    const second = accountService.createUserInExistingNamespace('transfer-2@example.com', first.namespaceId);
    const outsider = accountService.createUser('outsider@example.com');

    expect(setNamespaceOwner(first.namespaceId, 'outsider@example.com')).toMatchObject({ ok: false });
    expect(namespaceRepository.getOwnerUserId(first.namespaceId)).toBe(first.userId);

    getDb().prepare(`INSERT INTO namespace_invites (id, namespace_id, inviter_user_id, recipient_email_canonical, token_digest, created_at, expires_at)
      VALUES ('inv-transfer', ?, ?, 'friend@example.com', 'digest-transfer', 0, 9999999999999)`).run(first.namespaceId, first.userId);
    const result = setNamespaceOwner(first.namespaceId, 'transfer-2@example.com');
    expect(result).toEqual({ ok: true, previousOwnerUserId: first.userId, userId: second.userId });
    // The new owner controls further admissions: pending invitations are revoked.
    expect((getDb().prepare("SELECT status FROM namespace_invites WHERE id = 'inv-transfer'").get() as { status: string }).status).toBe('revoked');
    expect(isNamespaceOwner(second.userId, first.namespaceId)).toBe(true);
    expect(isNamespaceOwner(outsider.userId, first.namespaceId)).toBe(false);

    expect(setNamespaceOwner('local', 'transfer-2@example.com')).toMatchObject({ ok: false });
  });

  it('reports an owner who is no longer a member', () => {
    const owner = accountService.createUser('left@example.com');
    const member = accountService.createUserInExistingNamespace('stayed@example.com', owner.namespaceId);
    userRepository.removeUserFromNamespace(owner.userId, owner.namespaceId);
    expect(reportFor(owner.namespaceId)).toMatchObject({ status: 'invalid_owner', ownerEmail: 'left@example.com' });
    expect(member.namespaceId).toBe(owner.namespaceId);
  });

  it('keeps member invitations off by default', () => {
    const owner = accountService.createUser('invites@example.com');
    expect(namespaceRepository.getMemberInvitesEnabled(owner.namespaceId)).toBe(false);
    namespaceRepository.setMemberInvitesEnabled(owner.namespaceId, true);
    expect(namespaceRepository.getMemberInvitesEnabled(owner.namespaceId)).toBe(true);
  });
});
