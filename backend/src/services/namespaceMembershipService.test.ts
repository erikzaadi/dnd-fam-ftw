import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { migrate } from '../persistence/migrations.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { removeMember } from './namespaceMembershipService.js';
import { resolveVerifiedSignIn } from './signupService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-membership-test-${Date.now()}.sqlite`);

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1';
  process.env.OPENAI_API_KEY = 'test-invalid-key';
  initializeDatabase();
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

const insertSession = (id: string, namespaceId: string) => {
  getDb().prepare(
    'INSERT INTO sessions (id, scene, sceneId, worldDescription, turn, tone, displayName, difficulty, gameMode, useLocalAI, savingsMode, namespace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, 'Scene', 'scene-1', 'World', 1, 'tone', 'Adventure', 'normal', 'balanced', 0, 0, namespaceId);
};

const isMember = (email: string, namespaceId: string) =>
  userRepository.getUserNamespaces(email).some(namespace => namespace.id === namespaceId);

describe('removeMember', () => {
  it('stays removed after a restart and leaves no sign-in fallback', () => {
    const owner = userRepository.createUser('realm-owner@example.com');
    // Invite-created shape: the joined realm is the member's primary and only realm.
    userRepository.createUserInExistingNamespace('invitee@example.com', owner.namespaceId);

    const result = removeMember('invitee@example.com', owner.namespaceId);
    expect(result).toMatchObject({ ok: true, hasMemberships: false, primaryNamespaceId: owner.namespaceId });
    expect(isMember('invitee@example.com', owner.namespaceId)).toBe(false);

    // Startup migrations run again: the primary pointer must not restore membership.
    migrate(getDb());
    expect(isMember('invitee@example.com', owner.namespaceId)).toBe(false);

    // Sign-in finds no realm and goes to the picker, which shows the no-access screen.
    expect(resolveVerifiedSignIn('invitee@example.com', 'email')).toMatchObject({ kind: 'pick-namespace' });
  });

  it('moves the primary realm to a remaining membership, preferring one the user owns', () => {
    const host = userRepository.createUser('host@example.com');
    const guest = userRepository.createUser('guest-primary@example.com');
    userRepository.addUserToNamespace(guest.userId, host.namespaceId);
    userRepository.setPrimaryNamespace(guest.userId, host.namespaceId);

    expect(removeMember('guest-primary@example.com', host.namespaceId)).toMatchObject({ ok: true, primaryNamespaceId: guest.namespaceId, hasMemberships: true });
    expect(userRepository.getUserByEmail('guest-primary@example.com')?.namespace_id).toBe(guest.namespaceId);
    expect(resolveVerifiedSignIn('guest-primary@example.com', 'email')).toMatchObject({ kind: 'full', namespaceId: guest.namespaceId });
  });

  it('refuses to remove the owner', () => {
    const owner = userRepository.createUser('stuck-owner@example.com');
    expect(removeMember('stuck-owner@example.com', owner.namespaceId)).toMatchObject({ ok: false });
    expect(isMember('stuck-owner@example.com', owner.namespaceId)).toBe(true);
  });

  it('revokes the removed member\'s assistant tokens for that realm', () => {
    const owner = userRepository.createUser('token-owner@example.com');
    const member = userRepository.createUserInExistingNamespace('token-member@example.com', owner.namespaceId);
    getDb().prepare(`INSERT INTO access_tokens (id, user_id, namespace_id, label, token_prefix, token_digest, scopes, created_at, expires_at)
      VALUES ('tok-1', ?, ?, 'test', 'pfx', 'digest-1', '[]', 0, 9999999999999)`).run(member.userId, owner.namespaceId);
    removeMember('token-member@example.com', owner.namespaceId, 1234);
    const row = getDb().prepare("SELECT revoked_at FROM access_tokens WHERE id = 'tok-1'").get() as { revoked_at: number | null };
    expect(row.revoked_at).toBe(1234);
  });
});

describe('deleteUser with ownership', () => {
  it('refuses to delete the owner of a shared realm', () => {
    const owner = userRepository.createUser('shared-owner@example.com');
    userRepository.createUserInExistingNamespace('shared-member@example.com', owner.namespaceId);
    expect(userRepository.deleteUser('shared-owner@example.com')).toMatchObject({ ok: false });
    expect(userRepository.getUserByEmail('shared-owner@example.com')).not.toBeNull();
  });

  it('deleting a member never deletes the shared realm or other memberships', () => {
    const owner = userRepository.createUser('keeper@example.com');
    userRepository.createUserInExistingNamespace('leaver@example.com', owner.namespaceId);
    userRepository.createUserInExistingNamespace('stayer@example.com', owner.namespaceId);
    expect(userRepository.deleteUser('leaver@example.com')).toEqual({ ok: true, deletedNamespaceIds: [] });
    expect(namespaceRepository.getNamespaceById(owner.namespaceId)).not.toBeNull();
    expect(isMember('stayer@example.com', owner.namespaceId)).toBe(true);
    expect(isMember('keeper@example.com', owner.namespaceId)).toBe(true);
  });

  it('deletes a realm owned alone, but only once its adventures are gone', () => {
    const solo = userRepository.createUser('solo-player@example.com');
    insertSession('solo-adventure', solo.namespaceId);
    expect(userRepository.planAccountDeletion('solo-player@example.com')).toEqual({ ok: true, deleteNamespaceIds: [solo.namespaceId] });
    expect(userRepository.deleteUser('solo-player@example.com')).toMatchObject({ ok: false });

    getDb().prepare("DELETE FROM sessions WHERE id = 'solo-adventure'").run();
    expect(userRepository.deleteUser('solo-player@example.com')).toEqual({ ok: true, deletedNamespaceIds: [solo.namespaceId] });
    expect(namespaceRepository.getNamespaceById(solo.namespaceId)).toBeNull();
  });

  it('moves another account off a deleted realm it still points at', () => {
    const solo = userRepository.createUser('solo-2@example.com');
    const other = userRepository.createUser('pointer@example.com');
    getDb().prepare('UPDATE users SET namespace_id = ? WHERE id = ?').run(solo.namespaceId, other.userId);
    expect(userRepository.deleteUser('solo-2@example.com').ok).toBe(true);
    expect(userRepository.getUserByEmail('pointer@example.com')?.namespace_id).toBe(other.namespaceId);
  });
});

describe('deleteNamespace', () => {
  it('refuses while members remain and deletes an empty realm', () => {
    const owner = userRepository.createUser('ns-owner@example.com');
    expect(namespaceRepository.deleteNamespace(owner.namespaceId)).toMatchObject({ ok: false });
    const { namespaceId } = namespaceRepository.createNamespace('Empty');
    expect(namespaceRepository.deleteNamespace(namespaceId)).toEqual({ ok: true });
    expect(namespaceRepository.getNamespaceById(namespaceId)).toBeNull();
  });
});
