import { runInTransaction } from '../persistence/database.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';

// Every real (authenticated) namespace has exactly one owner, who exists and is a
// member. The users FK covers "exists" and blocks deleting an owner; the rest is
// enforced here and reported by `cli namespaces owners`. 'local' (auth disabled) is
// the one ownerless system namespace.
export const LOCAL_NAMESPACE_ID = 'local';

export type OwnershipStatus =
  | 'ok'            // owner set, exists, and is a member
  | 'invalid_owner' // owner set but no longer a member
  | 'proposed'      // no owner; exactly one member, who has this namespace as primary
  | 'unresolved';   // no owner and no safe automatic choice: operator mapping needed

export interface OwnershipReportMember {
  userId: string;
  email: string;
  isPrimary: boolean;
}

export interface OwnershipReportRow {
  namespaceId: string;
  name: string;
  ownerUserId: string | null;
  ownerEmail: string | null;
  members: OwnershipReportMember[];
  primaryReferences: number;
  status: OwnershipStatus;
  proposedOwner: { userId: string; email: string } | null;
  reason: string | null;
}

// Read-only. Proposes an owner only for a namespace with a single member who also has
// it as primary; never picks the oldest user or first row for shared namespaces.
export function buildOwnershipReport(): OwnershipReportRow[] {
  const byNamespace = new Map<string, { name: string; ownerUserId: string | null; members: OwnershipReportMember[] }>();
  for (const row of namespaceRepository.listMembershipRows()) {
    if (row.namespace_id === LOCAL_NAMESPACE_ID) {
      continue;
    }
    const entry = byNamespace.get(row.namespace_id) ?? { name: row.namespace_name, ownerUserId: row.owner_user_id, members: [] };
    if (row.user_id && row.email) {
      entry.members.push({ userId: row.user_id, email: row.email, isPrimary: row.is_primary === 1 });
    }
    byNamespace.set(row.namespace_id, entry);
  }

  return [...byNamespace.entries()].map(([namespaceId, entry]) => {
    const base = {
      namespaceId,
      name: entry.name,
      ownerUserId: entry.ownerUserId,
      ownerEmail: null as string | null,
      members: entry.members,
      primaryReferences: namespaceRepository.countPrimaryReferences(namespaceId),
      proposedOwner: null as { userId: string; email: string } | null,
    };
    if (entry.ownerUserId) {
      const owner = entry.members.find(member => member.userId === entry.ownerUserId);
      if (owner) {
        return { ...base, ownerEmail: owner.email, status: 'ok' as const, reason: null };
      }
      const ownerEmail = userRepository.getUserById(entry.ownerUserId)?.email ?? null;
      return { ...base, ownerEmail, status: 'invalid_owner' as const, reason: 'owner is not a member' };
    }
    if (entry.members.length === 0) {
      return { ...base, status: 'unresolved' as const, reason: 'no members' };
    }
    if (entry.members.length > 1) {
      return { ...base, status: 'unresolved' as const, reason: `${entry.members.length} members: choose one` };
    }
    const [only] = entry.members;
    if (!only.isPrimary) {
      return { ...base, status: 'unresolved' as const, reason: 'sole member has a different primary namespace' };
    }
    return { ...base, status: 'proposed' as const, proposedOwner: { userId: only.userId, email: only.email }, reason: null };
  });
}

// Applies only the report's 'proposed' owners, in one transaction.
export function applyProposedOwners(): number {
  const proposals = buildOwnershipReport().filter(row => row.status === 'proposed' && row.proposedOwner);
  runInTransaction(() => {
    for (const row of proposals) {
      namespaceRepository.setOwnerUserId(row.namespaceId, row.proposedOwner!.userId);
    }
  });
  return proposals.length;
}

export function countUnresolvedOwners(): number {
  return buildOwnershipReport().filter(row => row.status !== 'ok').length;
}

export type SetOwnerResult =
  | { ok: true; previousOwnerUserId: string | null; userId: string }
  | { ok: false; reason: string };

// Operator mapping and ownership transfer (cli namespaces set-owner). The new owner
// must already be a member. Transfer side effects (revoking pending invitations so the
// new owner controls further admissions) run in the same transaction.
export function setNamespaceOwner(namespaceId: string, email: string, onTransfer?: (namespaceId: string) => void): SetOwnerResult {
  if (namespaceId === LOCAL_NAMESPACE_ID) {
    return { ok: false, reason: 'The local namespace has no owner' };
  }
  if (!namespaceRepository.getNamespaceById(namespaceId)) {
    return { ok: false, reason: `Namespace not found: ${namespaceId}` };
  }
  const user = userRepository.getUserByEmail(email);
  if (!user) {
    return { ok: false, reason: `User not found: ${email}` };
  }
  if (!userRepository.isNamespaceMember(user.id, namespaceId)) {
    return { ok: false, reason: `${email} is not a member of ${namespaceId}; add them first (namespaces add-user)` };
  }
  const previousOwnerUserId = namespaceRepository.getOwnerUserId(namespaceId);
  if (previousOwnerUserId === user.id) {
    return { ok: true, previousOwnerUserId, userId: user.id };
  }
  runInTransaction(() => {
    namespaceRepository.setOwnerUserId(namespaceId, user.id);
    if (previousOwnerUserId) {
      onTransfer?.(namespaceId);
    }
  });
  return { ok: true, previousOwnerUserId, userId: user.id };
}

export function isNamespaceOwner(userId: string, namespaceId: string): boolean {
  return namespaceRepository.getOwnerUserId(namespaceId) === userId;
}
