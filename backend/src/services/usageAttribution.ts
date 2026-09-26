import type { UsageContext } from '../lib/usageContext.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { LOCAL_NAMESPACE_ID } from './namespaceOwnershipService.js';

// The one place a usage context is built for a real namespace, so browser requests,
// MCP calls and anything else acting for a namespace resolve its owner the same way:
// from the namespace record, never from the client, the actor's primary namespace, or
// the browser's current selection. An owner who is no longer a member does not count.
export function createUsageContext(namespaceId: string, userId: string | null): UsageContext {
  if (namespaceId === LOCAL_NAMESPACE_ID) {
    return { namespaceId, userId, ownerUserId: null, attribution: 'system' };
  }
  const ownerUserId = namespaceRepository.getOwnerUserId(namespaceId);
  if (!ownerUserId || !userRepository.isNamespaceMember(ownerUserId, namespaceId)) {
    return { namespaceId, userId, ownerUserId: null, attribution: 'unresolved' };
  }
  return { namespaceId, userId, ownerUserId, attribution: 'verified' };
}
