import { SessionState, Character, TurnResult, type Stat, type Difficulty, type Impact } from '../types.js';
import { getConfig } from '../config/env.js';
import { getImageStorageProvider } from '../providers/storage/storageProviderFactory.js';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { sessionRepository, type SessionListItem, type SessionPatch } from '../repositories/sessionRepository.js';
import { createId } from '../lib/ids.js';
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
    const db = getDb();
    const row = db.prepare('SELECT sessionId FROM characters WHERE id = ?').get(charId) as { sessionId: string } | undefined;
    return row ? row.sessionId : null;
  }

  public static async listAllCharacters(): Promise<Character[]> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM characters').all() as {
        id: string;
        name: string;
        class: string;
        species: string;
        quirk: string;
        hp: number;
        max_hp: number;
        might: number;
        magic: number;
        mischief: number;
        avatarUrl: string | null;
        status: string | null;
        history: string | null;
        gender: string | null;
    }[];
    return rows.map(char => ({
      id: char.id,
      name: char.name,
      class: char.class,
      species: char.species,
      quirk: char.quirk,
      hp: char.hp,
      max_hp: char.max_hp,
      status: (char.status as 'active' | 'downed') ?? 'active',
      avatarUrl: char.avatarUrl || undefined,
      history: char.history || undefined,
      gender: char.gender || undefined,
      stats: { might: char.might, magic: char.magic, mischief: char.mischief },
      inventory: []
    }));
  }

  public static async getTurnHistory(id: string): Promise<TurnResult[]> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM turn_history WHERE sessionId = ?').all(id) as {
      id: number;
      narration: string;
      rollNarration: string | null;
      imagePrompt: string | null;
      imageSuggested: number;
      imageUrl: string | null;
      image_storage_key: string | null;
      image_storage_provider: string | null;
      characterId: string | null;
      actionAttempt: string | null;
      actionStat: string | null;
      actionSuccess: number | null;
      actionRoll: number | null;
      actionStatBonus: number | null;
      actionItemBonus: number | null;
      actionIsCritical: number | null;
      actionImpact: string | null;
      actionDifficultyTarget: number | null;
      turnType: string | null;
      currentTensionLevel: string | null;
      hpChanges: string | null;
      inventoryChanges: string | null;
    }[];

    return rows.map(r => {
      const choices = db.prepare('SELECT * FROM turn_choices WHERE turnId = ?').all(r.id) as {
            label: string;
            difficulty: Difficulty;
            stat: Stat;
            difficultyValue: number | null;
            narration: string | null;
        }[];
      const rollTotal = (r.actionRoll ?? 0) + (r.actionStatBonus ?? 0) + (r.actionItemBonus ?? 0);
      const margin = r.actionDifficultyTarget != null
        ? (r.actionSuccess ? rollTotal - r.actionDifficultyTarget : r.actionDifficultyTarget - rollTotal)
        : 0;
      const derivedImpact: Impact = r.actionRoll === 1 || r.actionIsCritical || r.actionRoll === 20 || margin >= 12
        ? 'extreme'
        : margin >= 8
          ? 'strong'
          : 'normal';
      const lastAction = r.actionAttempt ? {
        actionAttempt: r.actionAttempt,
        actionResult: {
          success: !!r.actionSuccess,
          roll: r.actionRoll ?? 0,
          statUsed: (r.actionStat ?? 'none') as Stat | 'none',
          ...(r.actionStatBonus != null && { statBonus: r.actionStatBonus }),
          ...(r.actionItemBonus != null && r.actionItemBonus > 0 && { itemBonus: r.actionItemBonus }),
          impact: (r.actionImpact ?? derivedImpact) as Impact,
          ...(r.actionIsCritical && { isCritical: true }),
          ...(r.actionDifficultyTarget != null && { difficultyTarget: r.actionDifficultyTarget }),
        }
      } : null;
      // Recompute image URL from storage key so URLs always reflect current config.
      // Heals rows that were written before S3_IMAGE_PUBLIC_BASE_URL was set.
      let imageUrl = r.imageUrl;
      if (r.image_storage_key && r.image_storage_provider === 's3') {
        const storage = getImageStorageProvider();
        imageUrl = storage.getPublicUrl(r.image_storage_key);
      }
      return {
        id: r.id,
        narration: r.narration,
        rollNarration: r.rollNarration || undefined,
        imagePrompt: r.imagePrompt,
        imageSuggested: !!r.imageSuggested,
        imageUrl,
        characterId: r.characterId || undefined,
        choices: choices.map(({ difficultyValue, narration, ...c }) => ({
          ...c,
          ...(difficultyValue != null && { difficultyValue }),
          ...(narration != null && { narration }),
        })),
        lastAction,
        turnType: (r.turnType as TurnResult['turnType']) ?? 'normal',
        ...(r.currentTensionLevel && { currentTensionLevel: r.currentTensionLevel as TurnResult['currentTensionLevel'] }),
        ...(r.hpChanges && { hpChanges: JSON.parse(r.hpChanges) }),
        ...(r.inventoryChanges && { inventoryChanges: JSON.parse(r.inventoryChanges) }),
      };
    });
  }

  public static async updateStorySummary(sessionId: string, summary: string): Promise<void> {
    return sessionRepository.updateStorySummary(sessionId, summary);
  }

  public static async updateLatestTurnImage(sessionId: string, imageUrl: string, storageKey: string, storageProvider: string): Promise<void> {
    const db = getDb();
    db.prepare('UPDATE turn_history SET imageUrl = ?, image_storage_key = ?, image_storage_provider = ? WHERE id = (SELECT MAX(id) FROM turn_history WHERE sessionId = ?)')
      .run(imageUrl, storageKey || null, storageProvider || null, sessionId);
  }

  public static async addTurnResult(id: string, turn: TurnResult, characterId: string | null): Promise<number> {
    const db = getDb();
    const action = turn.lastAction ?? null;
    const info = db.prepare('INSERT INTO turn_history (sessionId, characterId, narration, rollNarration, imagePrompt, imageSuggested, imageUrl, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus, actionItemBonus, actionIsCritical, actionImpact, actionDifficultyTarget, turnType, currentTensionLevel, hpChanges, inventoryChanges) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        id, characterId || null, turn.narration, turn.rollNarration || null, turn.imagePrompt, turn.imageSuggested ? 1 : 0, turn.imageUrl || null,
        action?.actionAttempt ?? null,
        action?.actionResult?.statUsed ?? null,
        action?.actionResult?.success ? 1 : 0,
        action?.actionResult?.roll ?? null,
        action?.actionResult?.statBonus ?? null,
        action?.actionResult?.itemBonus ?? null,
        action?.actionResult?.isCritical ? 1 : null,
        action?.actionResult?.impact ?? null,
        action?.actionResult?.difficultyTarget ?? null,
        turn.turnType ?? 'normal',
        turn.currentTensionLevel ?? null,
        turn.hpChanges && turn.hpChanges.length > 0 ? JSON.stringify(turn.hpChanges) : null,
        turn.inventoryChanges && turn.inventoryChanges.length > 0 ? JSON.stringify(turn.inventoryChanges) : null
      );

    const turnId = info.lastInsertRowid;
    for (const choice of (turn.choices ?? [])) {
      db.prepare('INSERT INTO turn_choices (turnId, label, difficulty, stat, difficultyValue, narration) VALUES (?, ?, ?, ?, ?, ?)')
        .run(turnId, choice.label, choice.difficulty, choice.stat, choice.difficultyValue ?? null, choice.narration ?? null);
    }
    return Number(turnId);
  }

  public static deleteCharacter(charId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM inventory WHERE characterId = ?').run(charId);
    db.prepare('DELETE FROM characters WHERE id = ?').run(charId);
  }

  // --- Namespace / User management ---

  public static getUserByEmail(email: string): { id: string; email: string; namespace_id: string; role: string } | null {
    const db = getDb();
    return (db.prepare('SELECT id, email, namespace_id, role FROM users WHERE email = ?').get(email) as { id: string; email: string; namespace_id: string; role: string }) ?? null;
  }

  public static createUser(email: string, namespaceName?: string, role: string = 'member'): { userId: string; namespaceId: string } {
    const db = getDb();
    const namespaceId = createId();
    const userId = createId();
    const nsName = namespaceName ?? email.split('@')[0];
    db.prepare('INSERT INTO namespaces (id, name) VALUES (?, ?)').run(namespaceId, nsName);
    db.prepare('INSERT INTO users (id, email, namespace_id, role) VALUES (?, ?, ?, ?)').run(userId, email, namespaceId, role);
    db.prepare('INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(userId, namespaceId);
    return { userId, namespaceId };
  }

  public static ensureAdminUser(email: string): void {
    const existing = this.getUserByEmail(email);
    if (existing) {
      console.log(`[Auth] Admin user already exists: ${email} (namespace: ${existing.namespace_id})`);
      return;
    }
    const { userId, namespaceId } = this.createUser(email, 'Admin', 'admin');
    console.log(`[Auth] Created admin user: ${email} userId=${userId} namespaceId=${namespaceId}`);
  }

  public static listUsers(): { id: string; email: string; namespace_id: string; namespace_name: string; namespaces: { id: string; name: string }[]; role: string; created_at: string }[] {
    const db = getDb();
    const users = db.prepare(`
      SELECT u.id, u.email, u.namespace_id, n.name as namespace_name, u.role, u.created_at
      FROM users u JOIN namespaces n ON u.namespace_id = n.id
      ORDER BY u.created_at
    `).all() as { id: string; email: string; namespace_id: string; namespace_name: string; role: string; created_at: string }[];
    const userNamespaces = db.prepare(`
      SELECT un.user_id, n.id, n.name
      FROM user_namespaces un JOIN namespaces n ON n.id = un.namespace_id
    `).all() as { user_id: string; id: string; name: string }[];
    return users.map(u => ({
      ...u,
      namespaces: userNamespaces.filter(un => un.user_id === u.id).map(un => ({ id: un.id, name: un.name })),
    }));
  }

  public static deleteUser(email: string): boolean {
    const db = getDb();
    const user = this.getUserByEmail(email);
    if (!user) {
      return false;
    }
    db.prepare('DELETE FROM users WHERE email = ?').run(email);
    // Remove namespace if no other users reference it (and it's not 'local')
    if (user.namespace_id !== 'local') {
      const otherUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE namespace_id = ?').get(user.namespace_id) as { count: number };
      if (otherUsers.count === 0) {
        db.prepare('DELETE FROM namespaces WHERE id = ?').run(user.namespace_id);
      }
    }
    return true;
  }

  public static setPrimaryNamespace(email: string, namespaceId: string): { ok: boolean; reason?: string } {
    const db = getDb();
    const user = this.getUserByEmail(email);
    if (!user) {
      return { ok: false, reason: `User not found: ${email}` };
    }
    const ns = this.getNamespaceById(namespaceId);
    if (!ns) {
      return { ok: false, reason: `Namespace not found: ${namespaceId}` };
    }
    
    // Update users table
    db.prepare('UPDATE users SET namespace_id = ? WHERE id = ?').run(namespaceId, user.id);
    
    // Ensure they also have access to it in user_namespaces (it might already be there, OR IGNORE)
    db.prepare('INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(user.id, namespaceId);
    
    return { ok: true };
  }

  public static listNamespaces(): { id: string; name: string; user_count: number; session_count: number; max_sessions: number | null; max_turns: number | null; created_at: string }[] {
    const db = getDb();
    return db.prepare(`
      SELECT
        n.id, n.name, n.created_at, n.max_sessions, n.max_turns,
        COUNT(DISTINCT un.user_id) as user_count,
        COUNT(DISTINCT s.id) as session_count
      FROM namespaces n
      LEFT JOIN user_namespaces un ON un.namespace_id = n.id
      LEFT JOIN sessions s ON s.namespace_id = n.id
      GROUP BY n.id
      ORDER BY n.created_at
    `).all() as { id: string; name: string; user_count: number; session_count: number; max_sessions: number | null; max_turns: number | null; created_at: string }[];
  }

  public static getNamespaceById(id: string): { id: string; name: string } | null {
    const db = getDb();
    return (db.prepare('SELECT id, name FROM namespaces WHERE id = ?').get(id) as { id: string; name: string }) ?? null;
  }

  public static createNamespace(name: string): { namespaceId: string } {
    const db = getDb();
    const namespaceId = createId();
    db.prepare('INSERT INTO namespaces (id, name) VALUES (?, ?)').run(namespaceId, name);
    return { namespaceId };
  }

  public static renameNamespace(id: string, newName: string): boolean {
    const db = getDb();
    const result = db.prepare('UPDATE namespaces SET name = ? WHERE id = ?').run(newName, id);
    return result.changes > 0;
  }

  public static deleteNamespace(id: string): { ok: boolean; reason?: string } {
    const db = getDb();
    if (id === 'local') {
      return { ok: false, reason: 'Cannot delete the local namespace' };
    }
    const users = db.prepare('SELECT COUNT(*) as count FROM users WHERE namespace_id = ?').get(id) as { count: number };
    if (users.count > 0) {
      return { ok: false, reason: `Namespace has ${users.count} user(s) - remove them first` };
    }
    const sessions = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE namespace_id = ?').get(id) as { count: number };
    if (sessions.count > 0) {
      return { ok: false, reason: `Namespace has ${sessions.count} session(s) - delete them first` };
    }
    db.prepare('DELETE FROM namespaces WHERE id = ?').run(id);
    return { ok: true };
  }

  public static assignSessionToNamespace(sessionId: string, namespaceId: string): boolean {
    return sessionRepository.assignSessionToNamespace(sessionId, namespaceId);
  }

  public static listSessionsInNamespace(namespaceId: string): { id: string; displayName: string; turn: number; createdAt: string }[] {
    return sessionRepository.listSessionsInNamespace(namespaceId);
  }

  // --- Multi-namespace user access ---

  public static getUserNamespaces(email: string): { id: string; name: string }[] {
    const db = getDb();
    return db.prepare(`
      SELECT n.id, n.name
      FROM namespaces n
      JOIN user_namespaces un ON un.namespace_id = n.id
      JOIN users u ON u.id = un.user_id
      WHERE u.email = ?
      ORDER BY n.created_at
    `).all(email) as { id: string; name: string }[];
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
    getDb().prepare('INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) VALUES (?, ?)').run(user.id, namespaceId);
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
    const result = getDb().prepare('DELETE FROM user_namespaces WHERE user_id = ? AND namespace_id = ?').run(user.id, namespaceId);
    if (result.changes > 0) {
      return { ok: true };
    } else {
      return { ok: false, reason: `User ${email} did not have access to namespace ${namespaceId}` };
    }
  }

  // --- Namespace limits ---

  public static getNamespaceLimits(namespaceId: string): { maxSessions: number | null; maxTurns: number | null } {
    const db = getDb();
    const row = db.prepare('SELECT max_sessions, max_turns FROM namespaces WHERE id = ?').get(namespaceId) as { max_sessions: number | null; max_turns: number | null } | undefined;
    return { maxSessions: row?.max_sessions ?? null, maxTurns: row?.max_turns ?? null };
  }

  public static setNamespaceLimits(namespaceId: string, maxSessions: number | null, maxTurns: number | null): boolean {
    const db = getDb();
    const result = db.prepare('UPDATE namespaces SET max_sessions = ?, max_turns = ? WHERE id = ?').run(maxSessions, maxTurns, namespaceId);
    return result.changes > 0;
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
    const db = getDb();
    return db.prepare('SELECT narration, actionAttempt FROM turn_history WHERE characterId = ? ORDER BY id').all(charId) as { narration: string; actionAttempt: string | null }[];
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
