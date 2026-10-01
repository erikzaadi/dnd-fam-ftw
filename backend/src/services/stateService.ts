import { SessionState, TurnResult, type AdventureFormat, type GameMode, type ImagePolicy } from '../types.js';
import { characterRepository } from '../repositories/characterRepository.js';
import { inviteRequestRepository } from '../repositories/inviteRequestRepository.js';
import { namespaceRepository } from '../repositories/namespaceRepository.js';
import { sessionRepository, type SessionPatch } from '../repositories/sessionRepository.js';
import { turnHistoryRepository } from '../repositories/turnHistoryRepository.js';
import { usageRepository } from '../repositories/usageRepository.js';
import { userRepository, type DeleteUserResult } from '../repositories/userRepository.js';
import { deleteSessionWithAssets } from './sessionDeletionService.js';
import { removeMember } from './namespaceMembershipService.js';

// Compatibility facade retained for stable callers. Persistence should live in
// repositories; keep only cross-repository or side-effect orchestration here.
export class StateService {
  public static async createSession(worldDescription?: string, difficulty: string = 'normal', savingsMode: boolean = false, namespaceId: string = 'local', gameMode: GameMode = 'balanced', dmPrep?: string, initialDisplayName?: string, initialId?: string, adventureFormat: AdventureFormat = 'one_evening', imagePolicy?: ImagePolicy): Promise<SessionState> {
    return sessionRepository.createSession(worldDescription, difficulty, savingsMode, namespaceId, gameMode, dmPrep, initialDisplayName, initialId, adventureFormat, imagePolicy);
  }

  public static async setSavingsMode(id: string, enabled: boolean): Promise<void> {
    return sessionRepository.setSavingsMode(id, enabled);
  }

  public static async deleteSession(id: string): Promise<void> {
    return deleteSessionWithAssets(id);
  }

  public static async updateSession(id: string, state: SessionState): Promise<void> {
    return sessionRepository.updateSession(id, state);
  }

  public static updateSessionPreviewImage(id: string, url: string): void {
    sessionRepository.updateSessionPreviewImage(id, url);
  }

  public static async patchSession(id: string, fields: SessionPatch): Promise<void> {
    return sessionRepository.patchSession(id, fields);
  }

  public static async patchEncounterEnemyAvatar(sessionId: string, encounterId: string, enemyId: string, imageUrl: string): Promise<void> {
    return sessionRepository.patchEncounterEnemyAvatar(sessionId, encounterId, enemyId, imageUrl);
  }

  public static async patchEncounterAreaImage(sessionId: string, encounterId: string, areaId: string, imageUrl: string): Promise<void> {
    return sessionRepository.patchEncounterAreaImage(sessionId, encounterId, areaId, imageUrl);
  }

  public static async updateStorySummary(sessionId: string, summary: string, sourceTurn?: number): Promise<boolean> {
    return sessionRepository.updateStorySummary(sessionId, summary, sourceTurn);
  }

  public static async updateTurnImage(sessionId: string, turnId: number, imageUrl: string, storageKey: string, storageProvider: string): Promise<boolean> {
    return turnHistoryRepository.updateTurnImage(sessionId, turnId, imageUrl, storageKey, storageProvider);
  }

  public static setOriginStoryIfMissing(id: string, originStory: string, generatedAt: string): boolean {
    return sessionRepository.setOriginStoryIfMissing(id, originStory, generatedAt);
  }

  public static bumpRevision(id: string): number {
    return sessionRepository.bumpRevision(id);
  }

  public static async addTurnResult(id: string, turn: TurnResult, characterId: string | null): Promise<number> {
    return turnHistoryRepository.addTurnResult(id, turn, characterId);
  }

  public static updateCharacterAvatar(characterId: string, avatarUrl: string, avatarPrompt: string, avatarStorageKey: string, avatarStorageProvider: string): void {
    characterRepository.updateAvatar(characterId, avatarUrl, avatarPrompt, avatarStorageKey, avatarStorageProvider);
  }

  public static deleteCharacter(charId: string): void {
    characterRepository.deleteCharacter(charId);
  }

  // --- Namespace / User management ---

  public static createUser(email: string, namespaceName?: string, role: string = 'member'): { userId: string; namespaceId: string } {
    return userRepository.createUser(email, namespaceName, role);
  }

  public static ensureAdminUser(email: string): void {
    userRepository.ensureAdminUser(email);
  }

  public static deleteUser(email: string): DeleteUserResult {
    return userRepository.deleteUser(email);
  }

  public static recordLogin(email: string): void {
    userRepository.recordLogin(email);
  }

  public static setPrimaryNamespace(email: string, namespaceId: string): { ok: boolean; reason?: string } {
    const user = userRepository.getUserByEmail(email);
    if (!user) {
      return { ok: false, reason: `User not found: ${email}` };
    }
    const ns = namespaceRepository.getNamespaceById(namespaceId);
    if (!ns) {
      return { ok: false, reason: `Namespace not found: ${namespaceId}` };
    }
    userRepository.setPrimaryNamespace(user.id, namespaceId);
    return { ok: true };
  }

  public static createNamespace(name: string): { namespaceId: string } {
    return namespaceRepository.createNamespace(name);
  }

  public static renameNamespace(id: string, newName: string): boolean {
    return namespaceRepository.renameNamespace(id, newName);
  }

  public static deleteNamespace(id: string): { ok: boolean; reason?: string } {
    return namespaceRepository.deleteNamespace(id);
  }

  public static assignSessionToNamespace(sessionId: string, namespaceId: string): boolean {
    return sessionRepository.assignSessionToNamespace(sessionId, namespaceId);
  }

  // --- Multi-namespace user access ---

  public static getUserNamespaces(email: string): { id: string; name: string }[] {
    return userRepository.getUserNamespaces(email);
  }

  public static addUserToNamespace(email: string, namespaceId: string): { ok: boolean; reason?: string } {
    const user = userRepository.getUserByEmail(email);
    if (!user) {
      return { ok: false, reason: `User not found: ${email}` };
    }
    const ns = namespaceRepository.getNamespaceById(namespaceId);
    if (!ns) {
      return { ok: false, reason: `Namespace not found: ${namespaceId}` };
    }
    userRepository.addUserToNamespace(user.id, namespaceId);
    return { ok: true };
  }

  public static removeUserFromNamespace(email: string, namespaceId: string): { ok: boolean; reason?: string } {
    return removeMember(email, namespaceId);
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

  public static cloneOnboardingSession(namespaceId: string): string {
    return sessionRepository.cloneOnboardingSession(namespaceId);
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

  public static createUserInExistingNamespace(email: string, namespaceId: string, role?: string): { userId: string; namespaceId: string } {
    return userRepository.createUserInExistingNamespace(email, namespaceId, role);
  }
}
