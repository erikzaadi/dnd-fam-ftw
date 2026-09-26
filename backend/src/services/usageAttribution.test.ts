import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { setNamespaceOwner } from './namespaceOwnershipService.js';
import { createUsageContext } from './usageAttribution.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-attribution-test-${Date.now()}.sqlite`);

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1';
  process.env.OPENAI_API_KEY = 'test-invalid-key';
  initializeDatabase();
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

describe('createUsageContext', () => {
  it('attributes an actor in someone else\'s realm to that realm\'s owner', () => {
    const a = userRepository.createUser('attr-a@example.com');
    const b = userRepository.createUser('attr-b@example.com');
    userRepository.addUserToNamespace(b.userId, a.namespaceId);

    // B plays in A's realm R: actor B, owner A.
    expect(createUsageContext(a.namespaceId, b.userId)).toEqual({ namespaceId: a.namespaceId, userId: b.userId, ownerUserId: a.userId, attribution: 'verified' });
    // B switches to their own realm S: actor B, owner B.
    expect(createUsageContext(b.namespaceId, b.userId)).toMatchObject({ userId: b.userId, ownerUserId: b.userId, attribution: 'verified' });
  });

  it('applies an ownership transfer to new contexts only', () => {
    const a = userRepository.createUser('transfer-attr-a@example.com');
    const b = userRepository.createUserInExistingNamespace('transfer-attr-b@example.com', a.namespaceId);
    const before = createUsageContext(a.namespaceId, b.userId);
    expect(setNamespaceOwner(a.namespaceId, 'transfer-attr-b@example.com').ok).toBe(true);
    // Work that began before the transfer (and its background work) keeps its owner.
    expect(before.ownerUserId).toBe(a.userId);
    expect(createUsageContext(a.namespaceId, b.userId).ownerUserId).toBe(b.userId);
  });

  it('marks a real realm without a valid owner as unresolved instead of system usage', () => {
    const { namespaceId } = namespaceRepository.createNamespace('Ownerless');
    expect(createUsageContext(namespaceId, null)).toMatchObject({ ownerUserId: null, attribution: 'unresolved' });

    const owner = userRepository.createUser('departed-owner@example.com');
    userRepository.createUserInExistingNamespace('remaining@example.com', owner.namespaceId);
    getDb().prepare('DELETE FROM user_namespaces WHERE user_id = ? AND namespace_id = ?').run(owner.userId, owner.namespaceId);
    expect(createUsageContext(owner.namespaceId, null)).toMatchObject({ attribution: 'unresolved' });
  });

  it('treats the auth-disabled local realm as system usage', () => {
    expect(createUsageContext('local', null)).toEqual({ namespaceId: 'local', userId: null, ownerUserId: null, attribution: 'system' });
  });
});
