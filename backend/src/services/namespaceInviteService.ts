import crypto from 'crypto';
import { getConfig } from '../config/env.js';
import { canonicalEmail, maskEmail, parseEmailAddress } from '../lib/email.js';
import { createId } from '../lib/ids.js';
import { runInTransaction } from '../persistence/database.js';
import { getEmailProvider } from '../providers/email/emailProviderFactory.js';
import { inviteRequestRepository } from '../repositories/inviteRequestRepository.js';
import { namespaceInviteRepository, type NamespaceInviteRow } from '../repositories/namespaceInviteRepository.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import type {
  InspectInvitationResponse,
  InvitationErrorCode,
  InvitationState,
  InvitationSummary,
  NamespaceInvitationsResponse,
} from '../types.js';
import { buildInvitationEmail, enqueueSignupNotice, getAppUrl } from './emailService.js';
import { LOCAL_NAMESPACE_ID } from './namespaceOwnershipService.js';
import { isSignupPaused, startOfUtcDay } from './usageLimitService.js';

// Member invitations: an owner (or, when the owner allows it, any member) emails a
// single-use link that adds the recipient to the realm as an ordinary member. The link
// carries a random 32-byte token; only its SHA-256 digest is stored. Opening the link
// never grants access by itself: the recipient presses "Join realm" (a POST).

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const SENDS_PER_INVITER_PER_DAY = 10;
export const SENDS_PER_RECIPIENT_PER_DAY = 3;

export const isInvitesEnabled = (): boolean => getConfig().MEMBER_INVITES_ENABLED;

const digestToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export type InviteFailure = { ok: false; error: InvitationErrorCode; message: string; retryAfterSeconds?: number };
const failure = (error: InvitationErrorCode, message: string, retryAfterSeconds?: number): InviteFailure =>
  ({ ok: false, error, message, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) });

const isOwner = (userId: string, namespaceId: string) => namespaceRepository.getOwnerUserId(namespaceId) === userId;

// Only the owner, or any member when the owner has turned member invitations on.
export function canInvite(userId: string, namespaceId: string): boolean {
  if (!isInvitesEnabled() || namespaceId === LOCAL_NAMESPACE_ID || !userRepository.isNamespaceMember(userId, namespaceId)) {
    return false;
  }
  return isOwner(userId, namespaceId) || namespaceRepository.getMemberInvitesEnabled(namespaceId);
}

// Paid work needs a valid owner; so do new members.
function realmReady(namespaceId: string): boolean {
  const ownerUserId = namespaceRepository.getOwnerUserId(namespaceId);
  return !!ownerUserId && userRepository.isNamespaceMember(ownerUserId, namespaceId);
}

const toSummary = (row: NamespaceInviteRow, viewerUserId: string, now: number): InvitationSummary => ({
  id: row.id,
  email: row.recipient_email_canonical,
  mine: row.inviter_user_id === viewerUserId,
  createdAt: new Date(row.created_at).toISOString(),
  expiresAt: new Date(row.expires_at).toISOString(),
  expired: row.expires_at <= now,
  delivery: row.delivery_status,
  resendAvailableAt: new Date((row.last_sent_at ?? row.created_at) + RESEND_COOLDOWN_MS).toISOString(),
});

export function listInvitations(userId: string, namespaceId: string, now: number = Date.now()): NamespaceInvitationsResponse {
  const owner = isOwner(userId, namespaceId);
  const allowed = canInvite(userId, namespaceId);
  // Owners see every pending invitation; members see only their own.
  const rows = !isInvitesEnabled() ? [] : namespaceInviteRepository.listPending(namespaceId, owner ? undefined : userId);
  return {
    enabled: isInvitesEnabled(),
    canInvite: allowed,
    isOwner: owner,
    memberInvitesEnabled: namespaceRepository.getMemberInvitesEnabled(namespaceId),
    invitations: rows.map(row => toSummary(row, userId, now)),
  };
}

function checkSendLimits(inviterUserId: string, recipient: string, now: number): InviteFailure | null {
  const dayAgo = now - DAY_MS;
  if (namespaceInviteRepository.countSendsByInviterSince(inviterUserId, dayAgo) >= SENDS_PER_INVITER_PER_DAY
    || namespaceInviteRepository.countSendsToRecipientSince(recipient, dayAgo) >= SENDS_PER_RECIPIENT_PER_DAY
    || namespaceInviteRepository.countSendsSince(startOfUtcDay(new Date(now)).getTime()) >= getConfig().INVITE_DAILY_SEND_CAP) {
    return failure('rate_limited', 'That is a lot of invitations for one day. Try again tomorrow.');
  }
  return null;
}

// Creates (or, for a resend, replaces) the pending invitation and emails it. The email
// is sent after the transaction commits; success is reported only when the provider
// accepted it. A failed send leaves an unusable-in-practice pending row that the next
// resend supersedes.
async function issueInvitation(inviterUserId: string, namespaceId: string, recipient: string, now: number): Promise<{ ok: true; invitation: InvitationSummary } | InviteFailure> {
  const provider = getEmailProvider();
  if (!provider) {
    return failure('delivery_failed', 'Email is not set up on this server.');
  }
  const limited = checkSendLimits(inviterUserId, recipient, now);
  if (limited) {
    return limited;
  }
  const existing = namespaceInviteRepository.getPending(namespaceId, recipient);
  if (existing) {
    const cooldownEnds = (existing.last_sent_at ?? existing.created_at) + RESEND_COOLDOWN_MS;
    if (cooldownEnds > now) {
      return failure('cooldown', 'An invitation was just sent. Wait a moment before sending another.', Math.ceil((cooldownEnds - now) / 1000));
    }
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const row = {
    id: createId(),
    namespace_id: namespaceId,
    inviter_user_id: inviterUserId,
    recipient_email_canonical: recipient,
    // Bind to the account that exists now, so a deleted and recreated account with
    // the same email cannot use this link.
    recipient_user_id: userRepository.getUserByEmail(recipient)?.id ?? null,
    token_digest: digestToken(token),
    created_at: now,
    expires_at: now + INVITE_TTL_MS,
  };
  runInTransaction(() => {
    if (existing) {
      namespaceInviteRepository.resolve(existing.id, 'superseded', now);
    }
    namespaceInviteRepository.insert(row);
    namespaceInviteRepository.recordSend(inviterUserId, namespaceId, recipient, now);
  });

  const inviter = userRepository.getUserById(inviterUserId);
  const realm = namespaceRepository.getNamespaceById(namespaceId);
  try {
    await provider.send(buildInvitationEmail({
      to: recipient,
      inviterEmail: inviter?.email ?? 'A friend',
      realmName: realm?.name ?? 'a realm',
      link: `${getAppUrl()}accept-invite#token=${token}`,
      expiresAt: new Date(row.expires_at),
    }));
  } catch (err) {
    // Never log the message body: it contains the link.
    console.warn(`[Invites] Sending invitation ${row.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    namespaceInviteRepository.setDelivery(row.id, 'failed', now);
    return failure('delivery_failed', 'The invitation email could not be sent. Try again in a minute.');
  }
  namespaceInviteRepository.setDelivery(row.id, 'sent', now);
  console.log(`[Invites] Invitation ${row.id} sent for namespace ${namespaceId}`);
  return { ok: true, invitation: toSummary({ ...row, status: 'pending', resolved_at: null, accepted_user_id: null, created_account: 0, delivery_status: 'sent', last_sent_at: now }, inviterUserId, now) };
}

function checkCanInvite(userId: string, namespaceId: string): InviteFailure | null {
  if (!isInvitesEnabled()) {
    return failure('invites_disabled', 'Invitations are turned off right now.');
  }
  if (!canInvite(userId, namespaceId)) {
    return failure('forbidden', 'Only the realm owner can invite people to this realm.');
  }
  if (!realmReady(namespaceId)) {
    return failure('realm_not_ready', 'This realm is being set up. Ask the site operator to finish it.');
  }
  return null;
}

export async function createInvitation(inviterUserId: string, namespaceId: string, rawEmail: unknown, now: number = Date.now()): Promise<{ ok: true; invitation: InvitationSummary } | InviteFailure> {
  const denied = checkCanInvite(inviterUserId, namespaceId);
  if (denied) {
    return denied;
  }
  const recipient = parseEmailAddress(rawEmail);
  if (!recipient) {
    return failure('invalid_email', 'That does not look like an email address.');
  }
  // The inviter is a member, so telling them who else is a member reveals nothing new.
  const existingUser = userRepository.getUserByEmail(recipient);
  if (existingUser && userRepository.isNamespaceMember(existingUser.id, namespaceId)) {
    return failure('already_member', 'They are already in this realm.');
  }
  return issueInvitation(inviterUserId, namespaceId, recipient, now);
}

// The owner, or the original inviter while still allowed to invite. Rotates the token.
export async function resendInvitation(actorUserId: string, namespaceId: string, inviteId: string, now: number = Date.now()): Promise<{ ok: true; invitation: InvitationSummary } | InviteFailure> {
  const denied = checkCanInvite(actorUserId, namespaceId);
  if (denied) {
    return denied;
  }
  const invite = namespaceInviteRepository.getById(inviteId);
  if (!invite || invite.namespace_id !== namespaceId || invite.status !== 'pending'
    || (invite.inviter_user_id !== actorUserId && !isOwner(actorUserId, namespaceId))) {
    return failure('not_found', 'That invitation is no longer pending.');
  }
  return issueInvitation(actorUserId, namespaceId, invite.recipient_email_canonical, now);
}

export function revokeInvitation(actorUserId: string, namespaceId: string, inviteId: string, now: number = Date.now()): { ok: true } | InviteFailure {
  const invite = namespaceInviteRepository.getById(inviteId);
  if (!invite || invite.namespace_id !== namespaceId || invite.status !== 'pending'
    || !userRepository.isNamespaceMember(actorUserId, namespaceId)
    || (invite.inviter_user_id !== actorUserId && !isOwner(actorUserId, namespaceId))) {
    return failure('not_found', 'That invitation is no longer pending.');
  }
  namespaceInviteRepository.resolve(invite.id, 'revoked', now);
  return { ok: true };
}

export function setMemberInvites(actorUserId: string, namespaceId: string, enabled: boolean): { ok: true } | InviteFailure {
  if (!isOwner(actorUserId, namespaceId) || !userRepository.isNamespaceMember(actorUserId, namespaceId)) {
    return failure('forbidden', 'Only the realm owner can change this.');
  }
  namespaceRepository.setMemberInvitesEnabled(namespaceId, enabled);
  return { ok: true };
}

// --- Acceptance -------------------------------------------------------------------

// invite is set for every state except 'invalid'.
type TokenLookup = { state: InvitationState; invite: NamespaceInviteRow | null };

// Current state of the invitation a token names. Random tokens are 'invalid' with
// nothing else revealed; a matching token may learn why it no longer works.
function lookupToken(token: unknown, now: number): TokenLookup {
  if (typeof token !== 'string' || token.length < 20 || token.length > 128) {
    return { state: 'invalid', invite: null };
  }
  const invite = namespaceInviteRepository.getByDigest(digestToken(token));
  if (!invite) {
    return { state: 'invalid', invite: null };
  }
  if (!isInvitesEnabled()) {
    return { state: 'disabled', invite };
  }
  if (invite.status === 'accepted' || invite.status === 'revoked' || invite.status === 'superseded') {
    return { state: invite.status, invite };
  }
  if (invite.expires_at <= now) {
    return { state: 'expired', invite };
  }
  // Admission conditions that can change after sending: the realm still has a valid
  // owner, the inviter is still allowed to invite, and a bound account still exists.
  if (!realmReady(invite.namespace_id)
    || !userRepository.isNamespaceMember(invite.inviter_user_id, invite.namespace_id)
    || !(isOwner(invite.inviter_user_id, invite.namespace_id) || namespaceRepository.getMemberInvitesEnabled(invite.namespace_id))) {
    return { state: 'revoked', invite };
  }
  if (invite.recipient_user_id && userRepository.getUserByEmail(invite.recipient_email_canonical)?.id !== invite.recipient_user_id) {
    return { state: 'invalid', invite: null };
  }
  return { state: 'valid', invite };
}

// Relation of the signed-in account (if any) to the invitation's recipient.
function currentAccount(invite: NamespaceInviteRow, signedInUserId: string | null): 'none' | 'recipient' | 'other' {
  if (!signedInUserId) {
    return 'none';
  }
  const recipient = userRepository.getUserByEmail(invite.recipient_email_canonical);
  return recipient?.id === signedInUserId ? 'recipient' : 'other';
}

// Side-effect free: never consumes the invitation or grants anything.
export function inspectInvitation(token: unknown, signedInUserId: string | null, now: number = Date.now()): InspectInvitationResponse {
  const { state, invite } = lookupToken(token, now);
  if (!invite) {
    return { state: 'invalid' };
  }
  const realm = namespaceRepository.getNamespaceById(invite.namespace_id);
  const inviter = userRepository.getUserById(invite.inviter_user_id);
  const account = currentAccount(invite, signedInUserId);
  return {
    state,
    realmName: realm?.name,
    inviter: inviter ? maskEmail(inviter.email) : undefined,
    recipient: maskEmail(invite.recipient_email_canonical),
    expiresAt: new Date(invite.expires_at).toISOString(),
    currentAccount: account,
    canOpenRealm: state === 'accepted' && account === 'recipient' && !!signedInUserId
      && userRepository.isNamespaceMember(signedInUserId, invite.namespace_id),
  };
}

export type AcceptResult =
  | { ok: true; userId: string; email: string; namespaceId: string; created: boolean }
  | { ok: false; error: InvitationState | 'signed_in_as_other' | 'signup_closed' };

function canCreateInvitedAccount(now: number): boolean {
  const date = new Date(now);
  return !isSignupPaused(date)
    && namespaceInviteRepository.countAccountsCreatedSince(startOfUtcDay(date).getTime()) < getConfig().INVITE_DAILY_ACCOUNT_CAP;
}

// One transaction: revalidate, resolve or create the ordinary user, add membership,
// and consume the invitation conditionally. No network calls inside. Token possession
// proves control of the stored mailbox, so no extra code is sent. A browser signed in
// as someone else must confirm switching accounts; the invitation is never attached
// to the current account.
export function acceptInvitation(token: unknown, signedInUserId: string | null, confirmSwitch: boolean, now: number = Date.now()): AcceptResult {
  return runInTransaction((): AcceptResult => {
    const { state, invite } = lookupToken(token, now);
    if (state !== 'valid' || !invite) {
      return { ok: false, error: state };
    }
    if (currentAccount(invite, signedInUserId) === 'other' && !confirmSwitch) {
      return { ok: false, error: 'signed_in_as_other' };
    }

    let user = userRepository.getUserByEmail(invite.recipient_email_canonical);
    let created = false;
    if (!user) {
      if (!canCreateInvitedAccount(now)) {
        return { ok: false, error: 'signup_closed' };
      }
      // Invite-created accounts are ordinary members whose primary realm is the one
      // they joined; they get no private realm of their own.
      userRepository.createUserInExistingNamespace(invite.recipient_email_canonical, invite.namespace_id);
      user = userRepository.getUserByEmail(invite.recipient_email_canonical)!;
      created = true;
    } else {
      userRepository.addUserToNamespace(user.id, invite.namespace_id);
    }
    if (!namespaceInviteRepository.resolve(invite.id, 'accepted', now, { userId: user.id, createdAccount: created })) {
      throw new Error('Invitation was consumed concurrently');
    }
    inviteRequestRepository.removeInviteRequest(canonicalEmail(user.email));
    if (created) {
      enqueueSignupNotice({ userId: user.id, namespaceId: invite.namespace_id, email: user.email, method: 'invite', signedUpAt: new Date(now) });
      console.log(`[Invites] New account from invitation userId=${user.id} namespaceId=${invite.namespace_id}`);
    }
    return { ok: true, userId: user.id, email: user.email, namespaceId: invite.namespace_id, created };
  });
}
