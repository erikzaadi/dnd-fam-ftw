import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { removeMember } from './namespaceMembershipService.js';
import { buildOwnershipReport, setNamespaceOwner } from './namespaceOwnershipService.js';
import { accountService } from '../services/accountService.js';
import { realmAccess } from '../realms/access.js';

// Characterization of realm membership and ownership rules before the realm access
// extraction (architecture-deepening plan 2). Gaps only: see the plan's coverage notes
// for the rules other suites already pin.

const DB_PATH = path.join(os.tmpdir(), `dnd-realm-rules-test-${Date.now()}.sqlite`);

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1';
  process.env.OPENAI_API_KEY = 'test-invalid-key';
  initializeDatabase();
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

let seq = 0;
const email = (label: string) => `${label}-${++seq}@example.com`;

const insertPendingInvite = (namespaceId: string, inviterUserId: string): string => {
  const id = `inv-${++seq}`;
  getDb().prepare(`INSERT INTO namespace_invites (id, namespace_id, inviter_user_id, recipient_email_canonical, token_digest, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, 0, 9999999999999)`).run(id, namespaceId, inviterUserId, `friend-${seq}@example.com`, `digest-${id}`);
  return id;
};

const inviteStatus = (id: string) => (getDb().prepare('SELECT status FROM namespace_invites WHERE id = ?').get(id) as { status: string }).status;

// A user row whose primary pointer is the given realm, with no memberships at all.
const insertStrandedUser = (namespaceId: string): string => {
  const id = `stranded-${++seq}`;
  const address = `${id}@example.com`;
  getDb().prepare('INSERT INTO users (id, email, email_canonical, namespace_id, role) VALUES (?, ?, ?, ?, ?)').run(id, address, address, namespaceId, 'member');
  return id;
};

describe('setPrimaryNamespace', () => {
  it('grants membership and claims an ownerless realm', () => {
    const user = accountService.createUser(email('primary'));
    const { namespaceId } = namespaceRepository.createNamespace('Ownerless');
    expect(namespaceRepository.getOwnerUserId(namespaceId)).toBeNull();

    realmAccess.setPrimary(user.userId, namespaceId);

    expect(realmAccess.isMember(user.userId, namespaceId)).toBe(true);
    expect(namespaceRepository.getOwnerUserId(namespaceId)).toBe(user.userId);
    expect(userRepository.getUserById(user.userId)?.namespace_id).toBe(namespaceId);
  });
});

describe('the local realm', () => {
  it('accepts members and primaries but never gets an owner', () => {
    const member = accountService.createUser(email('local-member'));
    const primary = accountService.createUser(email('local-primary'));

    realmAccess.addMember(member.userId, 'local');
    realmAccess.setPrimary(primary.userId, 'local');

    expect(realmAccess.isMember(member.userId, 'local')).toBe(true);
    expect(realmAccess.isMember(primary.userId, 'local')).toBe(true);
    expect(userRepository.getUserById(primary.userId)?.namespace_id).toBe('local');
    expect(namespaceRepository.getOwnerUserId('local')).toBeNull();
  });
});

describe('replacement primary realm', () => {
  it('falls back to the oldest remaining realm when the user owns none of them', () => {
    const olderHost = accountService.createUser(email('older-host'));
    const newerHost = accountService.createUser(email('newer-host'));
    const currentHost = accountService.createUser(email('current-host'));
    const guestEmail = email('guest');
    const guest = accountService.createUserInExistingNamespace(guestEmail, currentHost.namespaceId);
    realmAccess.addMember(guest.userId, newerHost.namespaceId);
    realmAccess.addMember(guest.userId, olderHost.namespaceId);
    // created_at has second granularity: make the order explicit.
    getDb().prepare("UPDATE namespaces SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(olderHost.namespaceId);
    getDb().prepare("UPDATE namespaces SET created_at = '2021-01-01 00:00:00' WHERE id = ?").run(newerHost.namespaceId);

    expect(removeMember(guestEmail, currentHost.namespaceId)).toMatchObject({ ok: true, primaryNamespaceId: olderHost.namespaceId, hasMemberships: true });
    expect(userRepository.getUserById(guest.userId)?.namespace_id).toBe(olderHost.namespaceId);
  });
});

describe('deleteNamespace', () => {
  it('refuses an unknown realm', () => {
    expect(namespaceRepository.deleteNamespace('no-such-realm')).toMatchObject({ ok: false, reason: 'Namespace not found: no-such-realm' });
  });

  it('refuses while a user has it as primary and no other realm', () => {
    const { namespaceId } = namespaceRepository.createNamespace('Stranding');
    insertStrandedUser(namespaceId);

    const result = namespaceRepository.deleteNamespace(namespaceId);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('has this namespace as primary and no other realm');
    expect(namespaceRepository.getNamespaceById(namespaceId)).not.toBeNull();
  });

  it('moves a user who still points at it to their next membership', () => {
    const { namespaceId } = namespaceRepository.createNamespace('Leaving');
    const other = accountService.createUser(email('moved'));
    getDb().prepare('UPDATE users SET namespace_id = ? WHERE id = ?').run(namespaceId, other.userId);

    expect(namespaceRepository.deleteNamespace(namespaceId)).toEqual({ ok: true });
    expect(userRepository.getUserById(other.userId)?.namespace_id).toBe(other.namespaceId);
    expect(namespaceRepository.getNamespaceById(namespaceId)).toBeNull();
  });
});

describe('setNamespaceOwner', () => {
  it('is a no-op for the current owner and keeps pending invitations', () => {
    const ownerEmail = email('same-owner');
    const owner = accountService.createUser(ownerEmail);
    const invite = insertPendingInvite(owner.namespaceId, owner.userId);

    expect(setNamespaceOwner(owner.namespaceId, ownerEmail)).toEqual({ ok: true, previousOwnerUserId: owner.userId, userId: owner.userId });
    expect(inviteStatus(invite)).toBe('pending');
  });

  it('assigns a first owner without revoking pending invitations', () => {
    const { namespaceId } = namespaceRepository.createNamespace('First owner');
    const memberEmail = email('first-owner');
    const member = accountService.createUser(memberEmail);
    // A membership without the first-member owner claim, as in realms backfilled by hand.
    getDb().prepare('INSERT INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(member.userId, namespaceId);
    const invite = insertPendingInvite(namespaceId, member.userId);

    expect(setNamespaceOwner(namespaceId, memberEmail)).toEqual({ ok: true, previousOwnerUserId: null, userId: member.userId });
    expect(namespaceRepository.getOwnerUserId(namespaceId)).toBe(member.userId);
    expect(inviteStatus(invite)).toBe('pending');
  });
});

describe('buildOwnershipReport', () => {
  it('keeps the recorded owner id of an owner who left', () => {
    const owner = accountService.createUser(email('left-owner'));
    accountService.createUserInExistingNamespace(email('remaining'), owner.namespaceId);
    userRepository.removeUserFromNamespace(owner.userId, owner.namespaceId);

    expect(buildOwnershipReport().find(row => row.namespaceId === owner.namespaceId)).toMatchObject({
      status: 'invalid_owner',
      ownerUserId: owner.userId,
    });
  });
});
