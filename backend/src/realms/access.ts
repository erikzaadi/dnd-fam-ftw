import { runInTransaction } from '../persistence/database.js';
import { accessTokenRepository } from '../repositories/accessTokenRepository.js';
import { namespaceInviteRepository } from '../repositories/namespaceInviteRepository.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { claimIfFirstMember, deleteRealmCascade, LOCAL_REALM_ID, refuse, replacementPrimaries, type RealmRefusal } from './rules.js';

export { LOCAL_REALM_ID };

// Realm access: who belongs to a realm, who owns it, and which realm is a user's
// primary. Membership (user_namespaces) is the only source of access; the primary
// pointer is just the default at sign-in. Keyed by user id: callers that only have an
// email resolve the user first. Every write runs in one transaction, and joins the
// caller's when there is one (invite acceptance, signup).
//
// Refusal messages are the exact texts the CLI and HTTP routes print today.

export type RealmSummary = { id: string; name: string };

export type OwnershipInspection = {
  recordedOwnerId: string | null;
  // ok: the recorded owner is a member. invalid_owner: recorded but no longer a member.
  status: 'ok' | 'invalid_owner' | 'none';
};

export type AddMemberResult = { ok: true; claimedOwnership: boolean } | RealmRefusal<'not_found'>;
export type SetPrimaryResult = { ok: true; grantedMembership: boolean; claimedOwnership: boolean } | RealmRefusal<'not_found'>;
export type RemoveMemberResult =
  | { ok: true; primaryRealmId: string; hasMemberships: boolean }
  | RealmRefusal<'not_found' | 'not_member' | 'is_owner'>;
export type AssignOwnerResult = { ok: true; previousOwnerUserId: string | null } | RealmRefusal<'local' | 'not_found' | 'not_member'>;
export type DeleteRealmResult = { ok: true } | RealmRefusal<'local' | 'not_found' | 'has_members' | 'has_adventures' | 'stranded_primary'>;

const realmMissing = (realmId: string) => refuse('not_found', `Namespace not found: ${realmId}`);

export const realmAccess = {
  isMember(userId: string, realmId: string): boolean {
    return userRepository.isNamespaceMember(userId, realmId);
  },

  // The user's memberships, oldest realm first.
  realmsFor(userId: string): RealmSummary[] {
    return userRepository.listNamespacesForUser(userId);
  },

  // The owner, only when they exist and are still a member. Usage attribution and
  // invitations trust nothing else. The local realm has none.
  ownerOf(realmId: string): { userId: string } | null {
    if (realmId === LOCAL_REALM_ID) {
      return null;
    }
    const ownerUserId = namespaceRepository.getOwnerUserId(realmId);
    return ownerUserId && userRepository.isNamespaceMember(ownerUserId, realmId) ? { userId: ownerUserId } : null;
  },

  // Whether this user is the recorded owner (no membership check: an owner who left
  // still counts here, as for the owner badge and invitation rights today).
  isOwner(userId: string, realmId: string): boolean {
    return namespaceRepository.getOwnerUserId(realmId) === userId;
  },

  // The recorded owner even when no longer valid, for repair and reporting.
  inspectOwnership(realmId: string): OwnershipInspection {
    const recordedOwnerId = namespaceRepository.getOwnerUserId(realmId);
    if (!recordedOwnerId) {
      return { recordedOwnerId: null, status: 'none' };
    }
    return { recordedOwnerId, status: userRepository.isNamespaceMember(recordedOwnerId, realmId) ? 'ok' : 'invalid_owner' };
  },

  // A realm without owners (cli namespaces create): its first member claims it.
  createRealm(name: string): { realmId: string } {
    return { realmId: namespaceRepository.createNamespace(name).namespaceId };
  },

  // Adds a membership (a no-op when it exists). The first member of an ownerless realm
  // becomes its owner; the local realm takes members but never an owner.
  addMember(userId: string, realmId: string): AddMemberResult {
    if (!namespaceRepository.getNamespaceById(realmId)) {
      return realmMissing(realmId);
    }
    return runInTransaction(() => {
      userRepository.insertMembership(userId, realmId);
      return { ok: true as const, claimedOwnership: claimIfFirstMember(userId, realmId) };
    });
  },

  // Points the user's sign-in default at this realm. Also grants membership when
  // missing, and so can claim an ownerless realm. Allowed for the local realm.
  setPrimary(userId: string, realmId: string): SetPrimaryResult {
    if (!namespaceRepository.getNamespaceById(realmId)) {
      return realmMissing(realmId);
    }
    return runInTransaction(() => {
      userRepository.setPrimaryPointer(userId, realmId);
      const grantedMembership = userRepository.insertMembership(userId, realmId);
      return { ok: true as const, grantedMembership, claimedOwnership: claimIfFirstMember(userId, realmId) };
    });
  },

  // Ends access right away (cookies are rechecked per request), revokes the member's
  // personal access tokens and pending invitations for the realm, and repoints their
  // primary when it was this realm. OAuth grants are not revoked here: they are
  // refused at use because they check current membership. Refuses the owner. With no
  // memberships left the primary pointer stays (it must name a realm) but grants nothing.
  removeMember(userId: string, realmId: string, now: number = Date.now()): RemoveMemberResult {
    return runInTransaction((): RemoveMemberResult => {
      const user = userRepository.getUserById(userId);
      if (!user) {
        return refuse('not_found', `User not found: ${userId}`);
      }
      if (!userRepository.isNamespaceMember(userId, realmId)) {
        return refuse('not_member', `User ${user.email} did not have access to namespace ${realmId}`);
      }
      if (namespaceRepository.getOwnerUserId(realmId) === userId) {
        return refuse('is_owner', `${user.email} owns namespace ${realmId}: transfer ownership first (namespaces set-owner)`);
      }
      userRepository.removeUserFromNamespace(userId, realmId);
      accessTokenRepository.revokeForUserInNamespace(userId, realmId, now);
      namespaceInviteRepository.revokePendingByInviter(realmId, userId, now);
      const candidates = replacementPrimaries(userId, realmId);
      let primaryRealmId = user.namespace_id;
      if (user.namespace_id === realmId && candidates[0]) {
        primaryRealmId = candidates[0];
        userRepository.setPrimaryPointer(userId, primaryRealmId);
      }
      return { ok: true, primaryRealmId, hasMemberships: candidates.length > 0 };
    });
  },

  // Operator mapping and ownership transfer. The new owner must be a member.
  //   already the owner      -> no-op, invitations untouched
  //   first owner (none set) -> owner set, pending invitations kept
  //   transfer from another  -> owner set, all pending invitations revoked, so the new
  //                             owner controls further admissions
  assignOwner(realmId: string, userId: string, now: number = Date.now()): AssignOwnerResult {
    if (realmId === LOCAL_REALM_ID) {
      return refuse('local', 'The local namespace has no owner');
    }
    if (!namespaceRepository.getNamespaceById(realmId)) {
      return realmMissing(realmId);
    }
    const user = userRepository.getUserById(userId);
    if (!user) {
      return refuse('not_found', `User not found: ${userId}`);
    }
    if (!userRepository.isNamespaceMember(userId, realmId)) {
      return refuse('not_member', `${user.email} is not a member of ${realmId}; add them first (namespaces add-user)`);
    }
    const previousOwnerUserId = namespaceRepository.getOwnerUserId(realmId);
    if (previousOwnerUserId === userId) {
      return { ok: true, previousOwnerUserId };
    }
    runInTransaction(() => {
      namespaceRepository.setOwnerUserId(realmId, userId);
      if (previousOwnerUserId) {
        namespaceInviteRepository.revokeAllPending(realmId, now);
      }
    });
    return { ok: true, previousOwnerUserId };
  },

  // Explicit deletion of an empty realm. Checks and deletes run in one transaction, so
  // nothing can join or start an adventure in between. Users still pointing at it as
  // primary (without membership) move to their next realm.
  deleteRealm(realmId: string): DeleteRealmResult {
    if (realmId === LOCAL_REALM_ID) {
      return refuse('local', 'Cannot delete the local namespace');
    }
    return runInTransaction((): DeleteRealmResult => {
      if (!namespaceRepository.getNamespaceById(realmId)) {
        return realmMissing(realmId);
      }
      const members = namespaceRepository.countMembers(realmId);
      if (members > 0) {
        return refuse('has_members', `Namespace has ${members} member(s) - remove them first`);
      }
      const sessions = namespaceRepository.countSessions(realmId);
      if (sessions > 0) {
        return refuse('has_adventures', `Namespace has ${sessions} session(s) - delete them first`);
      }
      const nowhere = namespaceRepository.listPrimaryReferences(realmId).find(user => replacementPrimaries(user.id, realmId).length === 0);
      if (nowhere) {
        return refuse('stranded_primary', `${nowhere.email} has this namespace as primary and no other realm - remove that user first`);
      }
      deleteRealmCascade(realmId);
      return { ok: true };
    });
  },
};
