import { LOCAL_REALM_ID, realmAccess } from '../realms/access.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';

// Operator realm administration by email (the CLI and its tests): resolves the user,
// calls realm access, and keeps the result shapes and messages the CLI prints.

type AdminResult = { ok: true } | { ok: false; reason: string };

export type RemoveMemberResult =
  | { ok: true; primaryNamespaceId: string; hasMemberships: boolean }
  | { ok: false; reason: string };

export type SetOwnerResult =
  | { ok: true; previousOwnerUserId: string | null; userId: string }
  | { ok: false; reason: string };

const userNotFound = (email: string) => ({ ok: false as const, reason: `User not found: ${email}` });

export function addMember(email: string, namespaceId: string): AdminResult {
  const user = userRepository.getUserByEmail(email);
  if (!user) {
    return userNotFound(email);
  }
  const result = realmAccess.addMember(user.id, namespaceId);
  return result.ok ? { ok: true } : { ok: false, reason: result.message };
}

export function setPrimary(email: string, namespaceId: string): AdminResult {
  const user = userRepository.getUserByEmail(email);
  if (!user) {
    return userNotFound(email);
  }
  const result = realmAccess.setPrimary(user.id, namespaceId);
  return result.ok ? { ok: true } : { ok: false, reason: result.message };
}

export function removeMember(email: string, namespaceId: string, now: number = Date.now()): RemoveMemberResult {
  const user = userRepository.getUserByEmail(email);
  if (!user) {
    return userNotFound(email);
  }
  const result = realmAccess.removeMember(user.id, namespaceId, now);
  return result.ok
    ? { ok: true, primaryNamespaceId: result.primaryRealmId, hasMemberships: result.hasMemberships }
    : { ok: false, reason: result.message };
}

// cli namespaces set-owner: operator mapping and ownership transfer. Realm problems
// are reported before an unknown user, as the CLI always did.
export function setNamespaceOwner(namespaceId: string, email: string, now: number = Date.now()): SetOwnerResult {
  if (namespaceId === LOCAL_REALM_ID) {
    return { ok: false, reason: 'The local namespace has no owner' };
  }
  if (!namespaceRepository.getNamespaceById(namespaceId)) {
    return { ok: false, reason: `Namespace not found: ${namespaceId}` };
  }
  const user = userRepository.getUserByEmail(email);
  if (!user) {
    return userNotFound(email);
  }
  const result = realmAccess.assignOwner(namespaceId, user.id, now);
  return result.ok ? { ok: true, previousOwnerUserId: result.previousOwnerUserId, userId: user.id } : { ok: false, reason: result.message };
}

export function deleteRealm(namespaceId: string): AdminResult {
  const result = realmAccess.deleteRealm(namespaceId);
  return result.ok ? { ok: true } : { ok: false, reason: result.message };
}
