import { getDb, runInTransaction } from '../persistence/database.js';
import { accessTokenRepository } from '../repositories/accessTokenRepository.js';
import { namespaceInviteRepository } from '../repositories/namespaceInviteRepository.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';

export type RemoveMemberResult =
  | { ok: true; primaryNamespaceId: string; hasMemberships: boolean }
  | { ok: false; reason: string };

// Membership, not users.namespace_id, is the only source of access. Removing a member
// ends their access to the realm right away (cookies are rechecked per request), revokes
// their assistant tokens and pending invitations for it, and repoints their primary realm when it was this one.
// With no memberships left the primary pointer stays (it must reference a namespace)
// and the account simply has no realm to enter.
export function removeMember(email: string, namespaceId: string, now: number = Date.now()): RemoveMemberResult {
  const user = userRepository.getUserByEmail(email);
  if (!user) {
    return { ok: false, reason: `User not found: ${email}` };
  }
  if (!userRepository.isNamespaceMember(user.id, namespaceId)) {
    return { ok: false, reason: `User ${email} did not have access to namespace ${namespaceId}` };
  }
  if (namespaceRepository.getOwnerUserId(namespaceId) === user.id) {
    return { ok: false, reason: `${email} owns namespace ${namespaceId}: transfer ownership first (namespaces set-owner)` };
  }
  return runInTransaction(() => {
    userRepository.removeUserFromNamespace(user.id, namespaceId);
    accessTokenRepository.revokeForUserInNamespace(user.id, namespaceId, now);
    namespaceInviteRepository.revokePendingByInviter(namespaceId, user.id, now);
    const candidates = userRepository.getPrimaryCandidates(user.id, namespaceId);
    let primaryNamespaceId = user.namespace_id;
    if (user.namespace_id === namespaceId && candidates[0]) {
      primaryNamespaceId = candidates[0];
      getDb().prepare('UPDATE users SET namespace_id = ? WHERE id = ?').run(primaryNamespaceId, user.id);
    }
    return { ok: true as const, primaryNamespaceId, hasMemberships: candidates.length > 0 };
  });
}
