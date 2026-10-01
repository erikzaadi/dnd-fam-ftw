import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { claimIfFirstMember, deleteRealmCascade } from './rules.js';

// Internal realm building blocks for account workflows only (services/accountService.ts;
// enforced by ESLint). Each one is unchecked: the comment says what the caller must
// already have verified. Everything else uses realms/access.ts.

export const realmComposition = {
  // A new account's private realm. The realm row goes first (users.namespace_id
  // references it); call makeFounder once the user row exists.
  insertRealm(name: string, tier: string): string {
    return namespaceRepository.insertNamespace(name, tier).namespaceId;
  },

  // Caller: the user was just created with this realm as primary.
  makeFounder(userId: string, realmId: string): void {
    userRepository.insertMembership(userId, realmId);
    namespaceRepository.setOwnerUserId(realmId, userId);
  },

  // Caller: the user was just created with this existing realm as primary. An
  // ownerless realm (cli namespaces create) gets them as owner.
  joinExistingRealm(userId: string, realmId: string): void {
    userRepository.insertMembership(userId, realmId);
    claimIfFirstMember(userId, realmId);
  },

  // Caller: these realms go with an account being deleted (planAccountNamespaces).
  // Clears their owner first, breaking the users <-> namespaces reference before the
  // user row is deleted.
  releaseOwnership(realmIds: string[]): void {
    for (const realmId of realmIds) {
      namespaceRepository.clearOwner(realmId);
    }
  },

  // Caller: as releaseOwnership, after the user row is gone. Other users still pointing
  // at these realms move to their next membership.
  deleteRealms(realmIds: string[]): void {
    for (const realmId of realmIds) {
      deleteRealmCascade(realmId);
    }
  },
};
