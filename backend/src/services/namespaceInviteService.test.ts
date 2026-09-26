import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '../config/env.js';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { CaptureEmailProvider } from '../providers/email/CaptureEmailProvider.js';
import { setEmailProviderForTests } from '../providers/email/emailProviderFactory.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { removeMember } from './namespaceMembershipService.js';
import {
  acceptInvitation,
  createInvitation,
  inspectInvitation,
  listInvitations,
  resendInvitation,
  revokeInvitation,
  RESEND_COOLDOWN_MS,
  INVITE_TTL_MS,
  setMemberInvites,
} from './namespaceInviteService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-invite-test-${Date.now()}.sqlite`);
let mail: CaptureEmailProvider;
let clock = Date.UTC(2026, 8, 26, 12);

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1';
  process.env.OPENAI_API_KEY = 'test-invalid-key';
  process.env.MEMBER_INVITES_ENABLED = 'true';
  process.env.FRONTEND_URL = 'https://play.example.com';
  resetConfigForTests();
  initializeDatabase();
});

afterAll(() => {
  delete process.env.MEMBER_INVITES_ENABLED;
  resetConfigForTests();
  setEmailProviderForTests(null);
  fs.rmSync(DB_PATH, { force: true });
});

beforeEach(() => {
  mail = new CaptureEmailProvider();
  setEmailProviderForTests(mail);
  // Keep each test outside the others' resend cooldowns and daily limits.
  clock += 2 * 24 * 60 * 60 * 1000;
});

// The token from the most recent invitation email's link.
const lastToken = (): string => {
  const match = /accept-invite#token=([A-Za-z0-9_-]+)/.exec(mail.sent.at(-1)?.text ?? '');
  if (!match) {
    throw new Error('No invitation link sent');
  }
  return match[1];
};

let seq = 0;
const realm = () => {
  const email = `owner-${++seq}@example.com`;
  return { email, ...userRepository.createUser(email, `Realm ${seq}`) };
};

describe('member invitations', () => {
  it('lets a new person join by the emailed link, without a code, as an ordinary member', async () => {
    const owner = realm();
    const sent = await createInvitation(owner.userId, owner.namespaceId, ' New.Friend@Example.com ', clock);
    expect(sent).toMatchObject({ ok: true, invitation: { email: 'new.friend@example.com', delivery: 'sent' } });
    expect(mail.sent.at(-1)?.text).toContain('https://play.example.com/accept-invite#token=');
    expect(mail.sent.at(-1)?.text).toContain(owner.email);

    const token = lastToken();
    // Inspection (link previews, the page itself) grants nothing.
    expect(inspectInvitation(token, null, clock)).toMatchObject({ state: 'valid', realmName: `Realm ${seq}`, recipient: 'n***@example.com', currentAccount: 'none' });
    expect(inspectInvitation(token, null, clock)).toMatchObject({ state: 'valid' });
    expect(userRepository.getUserByEmail('new.friend@example.com')).toBeNull();

    const accepted = acceptInvitation(token, null, false, clock);
    expect(accepted).toMatchObject({ ok: true, namespaceId: owner.namespaceId, created: true });
    const user = userRepository.getUserByEmail('new.friend@example.com')!;
    expect(user.namespace_id).toBe(owner.namespaceId);
    expect(user.role).toBe('member');
    expect(userRepository.getUserNamespaces(user.email).map(n => n.id)).toEqual([owner.namespaceId]);
    expect(namespaceRepository.getOwnerUserId(owner.namespaceId)).toBe(owner.userId);

    // Single use: replay gets a typed state and no access.
    expect(acceptInvitation(token, null, false, clock)).toEqual({ ok: false, error: 'accepted' });
    expect(inspectInvitation(token, user.id, clock)).toMatchObject({ state: 'accepted', canOpenRealm: true });
  });

  it('adds an existing account without changing its primary realm or role', async () => {
    const owner = realm();
    const friend = realm();
    await createInvitation(owner.userId, owner.namespaceId, friend.email, clock);
    expect(acceptInvitation(lastToken(), friend.userId, false, clock)).toMatchObject({ ok: true, created: false, userId: friend.userId });
    const user = userRepository.getUserByEmail(friend.email)!;
    expect(user.namespace_id).toBe(friend.namespaceId);
    expect(userRepository.getUserNamespaces(friend.email).map(n => n.id).sort()).toEqual([owner.namespaceId, friend.namespaceId].sort());
  });

  it('never attaches the invitation to a different signed-in account without confirmation', async () => {
    const owner = realm();
    const other = realm();
    await createInvitation(owner.userId, owner.namespaceId, 'someone-else@example.com', clock);
    const token = lastToken();
    expect(inspectInvitation(token, other.userId, clock)).toMatchObject({ currentAccount: 'other' });
    expect(acceptInvitation(token, other.userId, false, clock)).toEqual({ ok: false, error: 'signed_in_as_other' });
    expect(userRepository.isNamespaceMember(other.userId, owner.namespaceId)).toBe(false);
    // Confirmed: the invited account joins, the signed-in one still does not.
    expect(acceptInvitation(token, other.userId, true, clock)).toMatchObject({ ok: true, email: 'someone-else@example.com' });
    expect(userRepository.isNamespaceMember(other.userId, owner.namespaceId)).toBe(false);
  });

  it('gives random tokens a generic invalid state', () => {
    expect(inspectInvitation('x'.repeat(43), null, clock)).toEqual({ state: 'invalid' });
    expect(inspectInvitation(12, null, clock)).toEqual({ state: 'invalid' });
    expect(acceptInvitation('y'.repeat(43), null, false, clock)).toEqual({ ok: false, error: 'invalid' });
  });

  it('expires, and a resend rotates the token and supersedes the old link', async () => {
    const owner = realm();
    const sent = await createInvitation(owner.userId, owner.namespaceId, 'late@example.com', clock);
    const first = lastToken();
    expect(inspectInvitation(first, null, clock + INVITE_TTL_MS)).toMatchObject({ state: 'expired' });

    expect(await resendInvitation(owner.userId, owner.namespaceId, sent.ok ? sent.invitation.id : '', clock + 1000)).toMatchObject({ ok: false, error: 'cooldown' });
    const resent = await resendInvitation(owner.userId, owner.namespaceId, sent.ok ? sent.invitation.id : '', clock + RESEND_COOLDOWN_MS);
    expect(resent.ok).toBe(true);
    const second = lastToken();
    expect(second).not.toBe(first);
    expect(acceptInvitation(first, null, false, clock + RESEND_COOLDOWN_MS)).toEqual({ ok: false, error: 'superseded' });
    expect(acceptInvitation(second, null, false, clock + RESEND_COOLDOWN_MS)).toMatchObject({ ok: true });
  });

  it('revocation wins over a later accept', async () => {
    const owner = realm();
    const sent = await createInvitation(owner.userId, owner.namespaceId, 'revoked@example.com', clock);
    const token = lastToken();
    expect(revokeInvitation(owner.userId, owner.namespaceId, sent.ok ? sent.invitation.id : '', clock)).toEqual({ ok: true });
    expect(acceptInvitation(token, null, false, clock)).toEqual({ ok: false, error: 'revoked' });
    expect(userRepository.getUserByEmail('revoked@example.com')).toBeNull();
  });

  it('is owner-only by default; members invite only when the owner allows it', async () => {
    const owner = realm();
    const member = userRepository.createUserInExistingNamespace(`member-${seq}@example.com`, owner.namespaceId);
    expect(await createInvitation(member.userId, owner.namespaceId, 'x@example.com', clock)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(setMemberInvites(member.userId, owner.namespaceId, true)).toMatchObject({ ok: false, error: 'forbidden' });

    expect(setMemberInvites(owner.userId, owner.namespaceId, true)).toEqual({ ok: true });
    const sent = await createInvitation(member.userId, owner.namespaceId, 'x@example.com', clock);
    expect(sent.ok).toBe(true);
    const token = lastToken();
    // Members see only their own invitations; the owner sees all and can revoke any.
    expect(listInvitations(member.userId, owner.namespaceId, clock).invitations).toHaveLength(1);
    expect(listInvitations(owner.userId, owner.namespaceId, clock).invitations[0]).toMatchObject({ mine: false });

    // Turning member invitations off also stops links members already sent.
    setMemberInvites(owner.userId, owner.namespaceId, false);
    expect(acceptInvitation(token, null, false, clock)).toEqual({ ok: false, error: 'revoked' });
  });

  it('revokes a removed member\'s pending invitations', async () => {
    const owner = realm();
    const member = userRepository.createUserInExistingNamespace(`leaving-${seq}@example.com`, owner.namespaceId);
    setMemberInvites(owner.userId, owner.namespaceId, true);
    await createInvitation(member.userId, owner.namespaceId, 'friend-of-leaver@example.com', clock);
    const token = lastToken();
    removeMember(`leaving-${seq}@example.com`, owner.namespaceId, clock);
    expect(acceptInvitation(token, null, false, clock)).toEqual({ ok: false, error: 'revoked' });
  });

  it('binds an invitation to the account that existed when it was sent', async () => {
    const owner = realm();
    const friend = realm();
    await createInvitation(owner.userId, owner.namespaceId, friend.email, clock);
    const token = lastToken();
    // The account is deleted and a new one with the same email appears.
    getDb().prepare('DELETE FROM sessions WHERE namespace_id = ?').run(friend.namespaceId);
    expect(userRepository.deleteUser(friend.email).ok).toBe(true);
    userRepository.createUser(friend.email);
    expect(acceptInvitation(token, null, false, clock)).toEqual({ ok: false, error: 'invalid' });
  });

  it('refuses members already in the realm and limits sends per recipient', async () => {
    const owner = realm();
    expect(await createInvitation(owner.userId, owner.namespaceId, owner.email, clock)).toMatchObject({ ok: false, error: 'already_member' });
    expect(await createInvitation(owner.userId, owner.namespaceId, 'not an email', clock)).toMatchObject({ ok: false, error: 'invalid_email' });

    const others = [realm(), realm(), realm(), realm()];
    for (const [i, other] of others.entries()) {
      const result = await createInvitation(other.userId, other.namespaceId, 'popular@example.com', clock + i);
      expect(result.ok).toBe(i < 3);
    }
  });

  it('reports a failed email instead of success', async () => {
    const owner = realm();
    setEmailProviderForTests({ send: async () => {
      throw new Error('SES down');
    } });
    expect(await createInvitation(owner.userId, owner.namespaceId, 'unlucky@example.com', clock)).toMatchObject({ ok: false, error: 'delivery_failed' });
    expect(listInvitations(owner.userId, owner.namespaceId, clock).invitations[0]).toMatchObject({ delivery: 'failed' });
  });

  it('blocks sending and accepting while the kill switch is off', async () => {
    const owner = realm();
    await createInvitation(owner.userId, owner.namespaceId, 'paused@example.com', clock);
    const token = lastToken();
    process.env.MEMBER_INVITES_ENABLED = 'false';
    resetConfigForTests();
    try {
      expect(await createInvitation(owner.userId, owner.namespaceId, 'another@example.com', clock)).toMatchObject({ ok: false, error: 'invites_disabled' });
      expect(acceptInvitation(token, null, false, clock)).toEqual({ ok: false, error: 'disabled' });
    } finally {
      process.env.MEMBER_INVITES_ENABLED = 'true';
      resetConfigForTests();
    }
    expect(acceptInvitation(token, null, false, clock)).toMatchObject({ ok: true });
  });
});
