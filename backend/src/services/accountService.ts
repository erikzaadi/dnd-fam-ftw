import { canonicalEmail } from '../lib/email.js';
import { runInTransaction } from '../persistence/database.js';
import { realmComposition } from '../realms/composition.js';
import { LOCAL_REALM_ID } from '../realms/access.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository, type DeleteUserResult, type UserRecord } from '../repositories/userRepository.js';

// Account workflows: creating and deleting a person's account together with the
// realms that come and go with it. Built on realms/composition (the only module
// allowed to use it) and plain repository rows. Every workflow runs in one
// transaction and joins the caller's when there is one (signup, invite acceptance).

type AccountRealmPlan = { ok: true; deleteNamespaceIds: string[] } | { ok: false; reason: string };

// Decides which realms go with an account. Refuses when the user owns a realm with
// other members, when a doomed realm still has adventures (unless the caller is only
// planning), or when another account still points at a doomed realm as primary with
// nowhere else to go.
function planAccountNamespaces(user: UserRecord, { ignoreSessions = false } = {}): AccountRealmPlan {
  const doomed: { id: string; name: string }[] = [];
  for (const namespace of namespaceRepository.listOwnedNamespaces(user.id)) {
    const others = namespaceRepository.countOtherMembers(namespace.id, user.id);
    if (others > 0) {
      return { ok: false, reason: `${user.email} owns realm "${namespace.name}" (${namespace.id}) shared with ${others} other member(s): transfer ownership first (namespaces set-owner)` };
    }
    doomed.push(namespace);
  }
  // Pre-ownership realms: the old rule deleted the primary realm with its last user.
  const primary = namespaceRepository.getNamespaceById(user.namespace_id);
  if (primary && primary.id !== LOCAL_REALM_ID && namespaceRepository.getOwnerUserId(primary.id) === null
    && namespaceRepository.countOtherMembers(primary.id, user.id) === 0) {
    doomed.push(primary);
  }
  for (const namespace of doomed) {
    const sessions = namespaceRepository.countSessions(namespace.id);
    if (sessions > 0 && !ignoreSessions) {
      return { ok: false, reason: `Realm "${namespace.name}" (${namespace.id}) still has ${sessions} adventure(s): delete them first` };
    }
    const stranded = namespaceRepository.listPrimaryReferences(namespace.id).filter(other => other.id !== user.id);
    for (const other of stranded) {
      const next = userRepository.getPrimaryCandidates(other.id, namespace.id).find(id => !doomed.some(d => d.id === id));
      if (!next) {
        return { ok: false, reason: `${other.email} has realm "${namespace.name}" as primary and no other realm: remove that user first` };
      }
    }
  }
  return { ok: true, deleteNamespaceIds: doomed.map(namespace => namespace.id) };
}

export const accountService = {
  // User + private realm (owned by the new user) + membership.
  createUser(email: string, namespaceName?: string, role: string = 'member', tier: string = 'unlimited'): { userId: string; namespaceId: string } {
    return runInTransaction(() => {
      // The realm row comes first (users.namespace_id references it); the owner is set
      // once the user exists, before commit.
      const namespaceId = realmComposition.insertRealm(namespaceName ?? email.trim().split('@')[0], tier);
      const userId = userRepository.insertUser(email, namespaceId, role);
      realmComposition.makeFounder(userId, namespaceId);
      return { userId, namespaceId };
    });
  },

  // Joins an existing realm as an ordinary member. Owner only when the realm had none
  // yet (an empty realm from cli namespaces create).
  createUserInExistingNamespace(email: string, namespaceId: string, role: string = 'member'): { userId: string; namespaceId: string } {
    return runInTransaction(() => {
      const userId = userRepository.insertUser(email, namespaceId, role);
      realmComposition.joinExistingRealm(userId, namespaceId);
      return { userId, namespaceId };
    });
  },

  ensureAdminUser(email: string): void {
    const existing = userRepository.getUserByEmail(email);
    if (existing) {
      console.log(`[Auth] Admin user already exists: ${email} (namespace: ${existing.namespace_id})`);
      return;
    }
    const { userId, namespaceId } = accountService.createUser(email, 'Admin', 'admin');
    console.log(`[Auth] Created admin user: ${email} userId=${userId} namespaceId=${namespaceId}`);
  },

  // Realms that would be deleted with this account, or why deletion is refused.
  planAccountDeletion(email: string): AccountRealmPlan {
    const user = userRepository.getUserByEmail(email);
    if (!user) {
      return { ok: false, reason: `User not found: ${email}` };
    }
    const plan = planAccountNamespaces(user, { ignoreSessions: true });
    return plan.ok ? { ok: true, deleteNamespaceIds: plan.deleteNamespaceIds } : plan;
  },

  // All-or-nothing. A user who owns a realm shared with others is refused (transfer
  // ownership first). Realms that go with the account: ones they own alone, and a
  // legacy ownerless primary realm where they are the only member. Those must have no
  // adventures left (the CLI deletes them first, with their images). Shared realms are
  // never deleted just because this user's primary reference goes away.
  deleteUser(email: string): DeleteUserResult {
    const user = userRepository.getUserByEmail(email);
    if (!user) {
      return { ok: false, notFound: true, reason: `User not found: ${email}` };
    }
    const plan = planAccountNamespaces(user);
    if (!plan.ok) {
      return plan;
    }
    runInTransaction(() => {
      realmComposition.releaseOwnership(plan.deleteNamespaceIds);
      // Nothing left behind that could bind to a later account with the same email
      // (sign-in codes, pending signup notices).
      userRepository.deleteUserRows(user.id, canonicalEmail(email), Date.now());
      realmComposition.deleteRealms(plan.deleteNamespaceIds);
    });
    return { ok: true, deletedNamespaceIds: plan.deleteNamespaceIds };
  },
};
