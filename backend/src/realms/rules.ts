import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';

// Private to realms/: the membership and ownership rules shared by access.ts and
// composition.ts. Nothing outside realms/ imports this file.

// The auth-disabled realm. It takes members and primary pointers but never an owner,
// and it can never be deleted.
export const LOCAL_REALM_ID = 'local';

export type RealmRefusal<Code extends string> = { ok: false; code: Code; message: string };

export const refuse = <Code extends string>(code: Code, message: string): RealmRefusal<Code> => ({ ok: false, code, message });

// The first member of a realm that has no owner yet becomes its owner. Never replaces
// an existing owner, and the local realm stays ownerless.
export const claimIfFirstMember = (userId: string, realmId: string): boolean =>
  realmId !== LOCAL_REALM_ID && namespaceRepository.setOwnerIfNone(realmId, userId);

// Where a user's primary pointer goes when it can no longer name this realm: realms
// they own first, then the oldest. Empty when they have no other membership.
export const replacementPrimaries = (userId: string, leavingRealmId: string): string[] =>
  userRepository.getPrimaryCandidates(userId, leavingRealmId);

// Deletes a realm and everything that belongs to it. Unchecked: the caller verified
// that deleting is allowed. Users still pointing at it as primary move to their next
// membership; one with nowhere to go makes this throw (the caller's transaction rolls back).
export const deleteRealmCascade = (realmId: string): void => {
  for (const other of namespaceRepository.listPrimaryReferences(realmId)) {
    const next = replacementPrimaries(other.id, realmId)[0];
    if (!next) {
      throw new Error(`User ${other.id} has namespace ${realmId} as primary and no other membership`);
    }
    userRepository.setPrimaryPointer(other.id, next);
  }
  namespaceRepository.deleteRealmRows(realmId);
};
