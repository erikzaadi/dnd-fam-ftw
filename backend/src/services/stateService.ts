import { SessionState, TurnResult, type Character } from '../types.js';
import { getConfig } from '../config/env.js';
import { getImageStorageProvider } from '../providers/storage/storageProviderFactory.js';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { characterRepository } from '../repositories/characterRepository.js';
import { namespaceRepository, type NamespaceListItem } from '../repositories/namespaceRepository.js';
import { sessionRepository, type SessionListItem, type SessionPatch } from '../repositories/sessionRepository.js';
import { turnHistoryRepository } from '../repositories/turnHistoryRepository.js';
import { userRepository, type UserListItem, type UserRecord } from '../repositories/userRepository.js';
import fs from 'fs';
import path from 'path';

export class StateService {
  // Ensures the DB is open and migrations have run. Safe to call multiple times.
  public static initialize(): void {
    initializeDatabase();
  }

  public static async createSession(worldDescription?: string, difficulty: string = 'normal', useLocalAI: boolean = false, savingsMode: boolean = false, namespaceId: string = 'local', gameMode: 'cinematic' | 'balanced' | 'fast' = 'balanced', dmPrep?: string): Promise<SessionState> {
    return sessionRepository.createSession(worldDescription, difficulty, useLocalAI, savingsMode, namespaceId, gameMode, dmPrep);
  }

  public static async getSession(id: string): Promise<SessionState | undefined> {
    return sessionRepository.getSession(id);
  }

  public static getSessionNamespaceId(id: string): string | undefined {
    return sessionRepository.getSessionNamespaceId(id);
  }

  public static async setSavingsMode(id: string, enabled: boolean): Promise<void> {
    return sessionRepository.setSavingsMode(id, enabled);
  }

  public static async setUseLocalAI(id: string, enabled: boolean): Promise<void> {
    return sessionRepository.setUseLocalAI(id, enabled);
  }

  public static async deleteSession(id: string): Promise<void> {
    const db = getDb();
    const config = getConfig();
    const storage = getImageStorageProvider();

    const deleteImage = async (imageUrl: string | null, storageKey: string | null, storageProvider: string | null) => {
      if (!imageUrl) {
        return;
      }
      if (storageKey && storageProvider) {
        try {
          await storage.deleteImage(storageKey);
        } catch (err) {
          console.warn(`[StateService] Failed to delete image key "${storageKey}" from ${storageProvider}:`, err);
        }
      } else {
        // Fallback for records created before storage key tracking: delete from local path
        const fileName = path.basename(imageUrl);
        const localPath = path.join(path.resolve(config.LOCAL_IMAGE_STORAGE_PATH), fileName);
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
        }
      }
    };

    const history = db.prepare('SELECT imageUrl, image_storage_key, image_storage_provider FROM turn_history WHERE sessionId = ?').all(id) as {
      imageUrl: string | null;
      image_storage_key: string | null;
      image_storage_provider: string | null;
    }[];
    for (const row of history) {
      await deleteImage(row.imageUrl, row.image_storage_key, row.image_storage_provider);
    }

    const characters = db.prepare('SELECT avatarUrl, avatar_storage_key, avatar_storage_provider FROM characters WHERE sessionId = ?').all(id) as {
      avatarUrl: string | null;
      avatar_storage_key: string | null;
      avatar_storage_provider: string | null;
    }[];
    for (const char of characters) {
      await deleteImage(char.avatarUrl, char.avatar_storage_key, char.avatar_storage_provider);
    }

    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    db.prepare('DELETE FROM turn_history WHERE sessionId = ?').run(id);
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

  public static async listSessions(namespaceId: string = 'local'): Promise<SessionListItem[]> {
    return sessionRepository.listSessions(namespaceId);
  }

  public static async getSessionIdForCharacter(charId: string): Promise<string | null> {
    return characterRepository.getSessionIdForCharacter(charId);
  }

  public static async listAllCharacters(): Promise<Character[]> {
    return characterRepository.listAllCharacters();
  }

  public static async getTurnHistory(id: string): Promise<TurnResult[]> {
    return turnHistoryRepository.getTurnHistory(id);
  }

  public static async updateStorySummary(sessionId: string, summary: string): Promise<void> {
    return sessionRepository.updateStorySummary(sessionId, summary);
  }

  public static async updateLatestTurnImage(sessionId: string, imageUrl: string, storageKey: string, storageProvider: string): Promise<void> {
    return turnHistoryRepository.updateLatestTurnImage(sessionId, imageUrl, storageKey, storageProvider);
  }

  public static async addTurnResult(id: string, turn: TurnResult, characterId: string | null): Promise<number> {
    return turnHistoryRepository.addTurnResult(id, turn, characterId);
  }

  public static deleteCharacter(charId: string): void {
    characterRepository.deleteCharacter(charId);
  }

  // --- Namespace / User management ---

  public static getUserByEmail(email: string): UserRecord | null {
    return userRepository.getUserByEmail(email);
  }

  public static createUser(email: string, namespaceName?: string, role: string = 'member'): { userId: string; namespaceId: string } {
    return userRepository.createUser(email, namespaceName, role);
  }

  public static ensureAdminUser(email: string): void {
    userRepository.ensureAdminUser(email);
  }

  public static listUsers(): UserListItem[] {
    return userRepository.listUsers();
  }

  public static deleteUser(email: string): boolean {
    return userRepository.deleteUser(email);
  }

  public static setPrimaryNamespace(email: string, namespaceId: string): { ok: boolean; reason?: string } {
    const user = this.getUserByEmail(email);
    if (!user) {
      return { ok: false, reason: `User not found: ${email}` };
    }
    const ns = this.getNamespaceById(namespaceId);
    if (!ns) {
      return { ok: false, reason: `Namespace not found: ${namespaceId}` };
    }
    userRepository.setPrimaryNamespace(user.id, namespaceId);
    return { ok: true };
  }

  public static listNamespaces(): NamespaceListItem[] {
    return namespaceRepository.listNamespaces();
  }

  public static getNamespaceById(id: string): { id: string; name: string } | null {
    return namespaceRepository.getNamespaceById(id);
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

  public static listSessionsInNamespace(namespaceId: string): { id: string; displayName: string; turn: number; createdAt: string }[] {
    return sessionRepository.listSessionsInNamespace(namespaceId);
  }

  // --- Multi-namespace user access ---

  public static getUserNamespaces(email: string): { id: string; name: string }[] {
    return userRepository.getUserNamespaces(email);
  }

  public static addUserToNamespace(email: string, namespaceId: string): { ok: boolean; reason?: string } {
    const user = this.getUserByEmail(email);
    if (!user) {
      return { ok: false, reason: `User not found: ${email}` };
    }
    const ns = this.getNamespaceById(namespaceId);
    if (!ns) {
      return { ok: false, reason: `Namespace not found: ${namespaceId}` };
    }
    userRepository.addUserToNamespace(user.id, namespaceId);
    return { ok: true };
  }

  public static removeUserFromNamespace(email: string, namespaceId: string): { ok: boolean; reason?: string } {
    const user = this.getUserByEmail(email);
    if (!user) {
      return { ok: false, reason: `User not found: ${email}` };
    }
    if (user.namespace_id === namespaceId) {
      return { ok: false, reason: `Cannot remove user from their primary namespace: ${namespaceId}` };
    }
    if (userRepository.removeUserFromNamespace(user.id, namespaceId)) {
      return { ok: true };
    } else {
      return { ok: false, reason: `User ${email} did not have access to namespace ${namespaceId}` };
    }
  }

  // --- Namespace limits ---

  public static getNamespaceLimits(namespaceId: string): { maxSessions: number | null; maxTurns: number | null } {
    return namespaceRepository.getNamespaceLimits(namespaceId);
  }

  public static setNamespaceLimits(namespaceId: string, maxSessions: number | null, maxTurns: number | null): boolean {
    return namespaceRepository.setNamespaceLimits(namespaceId, maxSessions, maxTurns);
  }

  public static countSessionsInNamespace(namespaceId: string): number {
    return sessionRepository.countSessionsInNamespace(namespaceId);
  }

  public static recordTtsUsage(namespaceId: string, voice: string, characterCount: number, provider: string = 'openai'): void {
    const db = getDb();
    db.prepare('INSERT INTO tts_usage (namespace_id, provider, voice, character_count) VALUES (?, ?, ?, ?)')
      .run(namespaceId, provider, voice, characterCount);
  }

  public static getTtsUsage(namespaceId: string): { requestCount: number; characterCount: number } {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as requestCount, COALESCE(SUM(character_count), 0) as characterCount FROM tts_usage WHERE namespace_id = ?')
      .get(namespaceId) as { requestCount: number; characterCount: number };
    return { requestCount: row.requestCount, characterCount: row.characterCount };
  }

  // --- Character history ---

  public static getCharacterTurnHistory(charId: string): { narration: string; actionAttempt: string | null }[] {
    return turnHistoryRepository.getCharacterTurnHistory(charId);
  }

  // --- Invite requests ---

  public static hasInviteRequest(email: string): boolean {
    const db = getDb();
    const row = db.prepare('SELECT id FROM invite_requests WHERE email = ?').get(email) as { id: number } | undefined;
    return !!row;
  }

  public static addInviteRequest(email: string, message?: string): void {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO invite_requests (email, message) VALUES (?, ?)').run(email, message ?? null);
  }

  public static listInviteRequests(): { id: number; email: string; message: string | null; created_at: string }[] {
    const db = getDb();
    return db.prepare('SELECT id, email, message, created_at FROM invite_requests ORDER BY created_at DESC').all() as { id: number; email: string; message: string | null; created_at: string }[];
  }

  public static clearInviteRequests(): number {
    const db = getDb();
    const result = db.prepare('DELETE FROM invite_requests').run();
    return result.changes;
  }
}
