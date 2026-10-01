import { inviteRequestRepository } from '../repositories/inviteRequestRepository.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { usageRepository } from '../repositories/usageRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { deleteAdventure } from '../archive/adventureDeletion.js';

// Compatibility facade retained for stable callers. Persistence should live in
// repositories; keep only cross-repository or side-effect orchestration here.
export class StateService {


  public static async deleteSession(id: string): Promise<void> {
    await deleteAdventure(id);
  }













  // --- Namespace / User management ---

  public static recordLogin(email: string): void {
    userRepository.recordLogin(email);
  }

  public static renameNamespace(id: string, newName: string): boolean {
    return namespaceRepository.renameNamespace(id, newName);
  }


  // --- Namespace limits ---

  public static getNamespaceLimits(namespaceId: string): { maxSessions: number | null; maxTurns: number | null } {
    return namespaceRepository.getNamespaceLimits(namespaceId);
  }

  public static setNamespaceTier(namespaceId: string, tier: string): boolean {
    return namespaceRepository.setNamespaceTier(namespaceId, tier);
  }

  public static setNamespaceLimits(namespaceId: string, maxSessions: number | null, maxTurns: number | null): boolean {
    return namespaceRepository.setNamespaceLimits(namespaceId, maxSessions, maxTurns);
  }


  public static recordTtsUsage(namespaceId: string, voice: string, characterCount: number, provider: string = 'openai'): void {
    usageRepository.recordTtsUsage(namespaceId, voice, characterCount, provider);
  }

  // --- Invite requests ---

  public static addInviteRequest(email: string, message?: string): void {
    inviteRequestRepository.addInviteRequest(email, message);
  }

  public static removeInviteRequest(email: string): boolean {
    return inviteRequestRepository.removeInviteRequest(email);
  }

  public static clearInviteRequests(): number {
    return inviteRequestRepository.clearInviteRequests();
  }

}
