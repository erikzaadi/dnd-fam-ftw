import { createId } from '../lib/ids.js';
import { getDb } from '../persistence/database.js';
import { generateSessionDisplayName } from '../services/sessionNameService.js';
import { SessionState, InventoryItem, type GameMode } from '../types.js';

export type SessionListItem = {
  id: string;
  displayName: string;
  worldDescription?: string;
  storySummary?: string;
  dmPrep?: string;
  difficulty: string;
  gameMode: string;
  gameOver?: boolean;
  previewImageUrl?: string;
  party: {
    id: string;
    name: string;
    class: string;
    species: string;
    avatarUrl?: string;
    hp: number;
    max_hp: number;
  }[];
};

export type SessionPatch = {
  difficulty?: string;
  gameMode?: string;
  dmPrep?: string | null;
  dmPrepImageBrief?: string | null;
  worldDescription?: string | null;
};

export const sessionRepository = {
  async createSession(
    worldDescription?: string,
    difficulty: string = 'normal',
    useLocalAI: boolean = false,
    savingsMode: boolean = false,
    namespaceId: string = 'local',
    gameMode: 'cinematic' | 'balanced' | 'fast' = 'balanced',
    dmPrep?: string,
  ): Promise<SessionState> {
    const db = getDb();
    const id = createId();
    const displayName = await generateSessionDisplayName(worldDescription, useLocalAI);

    db.prepare('INSERT INTO sessions (id, scene, sceneId, worldDescription, dm_prep, dm_prep_image_brief, turn, tone, displayName, difficulty, gameMode, useLocalAI, savingsMode, namespace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, "A New Realm", "start-1", worldDescription || null, dmPrep || null, null, 1, "thrilling adventure", displayName, difficulty, gameMode, useLocalAI ? 1 : 0, savingsMode ? 1 : 0, namespaceId);

    return {
      id,
      scene: "A New Realm",
      sceneId: "start-1",
      worldDescription,
      dmPrep,
      dmPrepImageBrief: undefined,
      turn: 1,
      party: [],
      activeCharacterId: "",
      npcs: [],
      quests: [],
      lastChoices: [],
      tone: "thrilling adventure",
      gameMode,
      recentHistory: ["Adventure begins!"],
      displayName,
      difficulty,
      savingsMode,
      useLocalAI,
      interventionState: { rescuesUsed: 0 },
      storySummary: '',
      gameOver: false,
    };
  },

  async getSession(id: string): Promise<SessionState | undefined> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as {
      id: string;
      scene: string;
      sceneId: string;
      worldDescription: string | null;
      dm_prep: string | null;
      dm_prep_image_brief: string | null;
      turn: number;
      activeCharacterId: string;
      tone: string;
      displayName: string;
      difficulty: string;
      gameMode: string;
      savingsMode: number;
      useLocalAI: number;
      interventionUsed: number;
      rescues_used: number;
      game_over: number;
      storySummary: string;
      preview_image_url: string | null;
    } | undefined;
    if (!row) {
      return undefined;
    }

    const characters = db.prepare('SELECT * FROM characters WHERE sessionId = ?').all(id) as {
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
      avatarPrompt: string | null;
      avatar_storage_key: string | null;
      avatar_storage_provider: string | null;
      status: string | null;
      history: string | null;
      gender: string | null;
    }[];
    for (const char of characters) {
      const rawInv = db.prepare('SELECT * FROM inventory WHERE characterId = ?').all(char.id) as {
        id: number;
        itemId: string | null;
        name: string;
        description: string;
        statBonuses: string | null;
        healValue: number | null;
        transferable: number | null;
        consumable: number | null;
      }[];
      (char as unknown as { inventory: InventoryItem[] }).inventory = rawInv.map(i => ({
        id: i.itemId ?? String(i.id),
        name: i.name,
        description: i.description,
        statBonuses: i.statBonuses ? JSON.parse(i.statBonuses) : undefined,
        healValue: i.healValue ?? undefined,
        transferable: i.transferable != null ? !!i.transferable : undefined,
        consumable: i.consumable != null ? !!i.consumable : undefined,
      }));
      (char as unknown as { stats: { might: number, magic: number, mischief: number } }).stats = { might: char.might, magic: char.magic, mischief: char.mischief };
    }

    return {
      id: row.id,
      scene: row.scene,
      sceneId: row.sceneId,
      worldDescription: row.worldDescription || undefined,
      dmPrep: row.dm_prep || undefined,
      dmPrepImageBrief: row.dm_prep_image_brief || undefined,
      turn: row.turn,
      party: characters.map(c => ({
        id: c.id,
        name: c.name,
        class: c.class,
        species: c.species,
        quirk: c.quirk,
        hp: c.hp,
        max_hp: c.max_hp,
        status: c.hp === 0 ? 'downed' : ((c.status as 'active' | 'downed') ?? 'active'),
        avatarUrl: c.avatarUrl || undefined,
        avatarPrompt: c.avatarPrompt || undefined,
        avatarStorageKey: c.avatar_storage_key || undefined,
        avatarStorageProvider: c.avatar_storage_provider || undefined,
        history: c.history || undefined,
        gender: c.gender || undefined,
        stats: (c as unknown as { stats: { might: number, magic: number, mischief: number } }).stats,
        inventory: (c as unknown as { inventory: InventoryItem[] }).inventory,
      })),
      activeCharacterId: row.activeCharacterId || "",
      npcs: [],
      quests: [],
      lastChoices: [],
      tone: row.tone,
      recentHistory: (() => {
        const rows = db.prepare('SELECT narration FROM turn_history WHERE sessionId = ? ORDER BY id DESC LIMIT 3').all(id) as { narration: string }[];
        return rows.length > 0 ? rows.reverse().map(r => r.narration) : ['Adventure begins!'];
      })(),
      displayName: row.displayName,
      difficulty: row.difficulty,
      gameMode: (row.gameMode as GameMode) || 'balanced',
      savingsMode: !!row.savingsMode,
      useLocalAI: !!row.useLocalAI,
      interventionState: { rescuesUsed: row.rescues_used ?? (row.interventionUsed ? 1 : 0) },
      storySummary: row.storySummary ?? '',
      gameOver: !!row.game_over,
      previewImageUrl: row.preview_image_url || undefined,
    };
  },

  getSessionNamespaceId(id: string): string | undefined {
    const db = getDb();
    const row = db.prepare('SELECT namespace_id FROM sessions WHERE id = ?').get(id) as { namespace_id: string } | undefined;
    return row?.namespace_id;
  },

  async setSavingsMode(id: string, enabled: boolean): Promise<void> {
    const db = getDb();
    db.prepare('UPDATE sessions SET savingsMode = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  },

  async setUseLocalAI(id: string, enabled: boolean): Promise<void> {
    const db = getDb();
    db.prepare('UPDATE sessions SET useLocalAI = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  },

  async updateSession(id: string, state: SessionState): Promise<void> {
    const db = getDb();
    const rescuesUsed = state.interventionState?.rescuesUsed ?? 0;
    db.prepare('UPDATE sessions SET scene = ?, sceneId = ?, turn = ?, activeCharacterId = ?, tone = ?, interventionUsed = ?, rescues_used = ?, game_over = ?, storySummary = ?, difficulty = ?, gameMode = ? WHERE id = ?')
      .run(state.scene, state.sceneId, state.turn, state.activeCharacterId, state.tone, rescuesUsed > 0 ? 1 : 0, rescuesUsed, state.gameOver ? 1 : 0, state.storySummary ?? '', state.difficulty, state.gameMode ?? 'balanced', id);

    for (const char of state.party) {
      db.prepare('INSERT OR REPLACE INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, avatarUrl, avatarPrompt, status, avatar_storage_key, avatar_storage_provider, history, gender) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(char.id, id, char.name, char.class, char.species, char.quirk, char.hp, char.max_hp, char.stats.might, char.stats.magic, char.stats.mischief, char.avatarUrl || null, char.avatarPrompt || null, char.status ?? 'active', char.avatarStorageKey || null, char.avatarStorageProvider || null, char.history || null, char.gender || null);

      db.prepare('DELETE FROM inventory WHERE characterId = ?').run(char.id);
      for (const item of (char.inventory ?? [])) {
        db.prepare('INSERT INTO inventory (characterId, itemId, name, description, statBonuses, healValue, transferable, consumable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(char.id, item.id, item.name, item.description, item.statBonuses ? JSON.stringify(item.statBonuses) : null, item.healValue ?? null, item.transferable != null ? (item.transferable ? 1 : 0) : null, item.consumable != null ? (item.consumable ? 1 : 0) : null);
      }
    }
  },

  updateSessionPreviewImage(id: string, url: string): void {
    const db = getDb();
    db.prepare('UPDATE sessions SET preview_image_url = ? WHERE id = ?').run(url, id);
  },

  async patchSession(id: string, fields: SessionPatch): Promise<void> {
    const db = getDb();
    const colMap: Record<string, string> = { difficulty: 'difficulty', gameMode: 'gameMode', dmPrep: 'dm_prep', dmPrepImageBrief: 'dm_prep_image_brief', worldDescription: 'worldDescription' };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, col] of Object.entries(colMap)) {
      if (key in fields) {
        sets.push(`${col} = ?`);
        values.push((fields as Record<string, unknown>)[key] ?? null);
      }
    }
    if (sets.length === 0) {
      return;
    }
    db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  },

  async listSessions(namespaceId: string = 'local'): Promise<SessionListItem[]> {
    const db = getDb();
    const rows = db.prepare('SELECT id, displayName, worldDescription, storySummary, dm_prep, difficulty, gameMode, game_over, preview_image_url FROM sessions WHERE namespace_id = ? ORDER BY createdAt DESC').all(namespaceId) as { id: string; displayName: string; worldDescription: string | null; storySummary: string | null; dm_prep: string | null; difficulty: string; gameMode: string; game_over: number; preview_image_url: string | null }[];
    return rows.map(row => {
      const chars = db.prepare('SELECT id, name, class, species, avatarUrl, hp, max_hp FROM characters WHERE sessionId = ?').all(row.id) as { id: string; name: string; class: string; species: string; avatarUrl: string | null; hp: number; max_hp: number }[];
      return {
        id: row.id,
        displayName: row.displayName,
        worldDescription: row.worldDescription || undefined,
        storySummary: row.storySummary || undefined,
        dmPrep: row.dm_prep || undefined,
        difficulty: row.difficulty,
        gameMode: row.gameMode,
        gameOver: !!row.game_over || undefined,
        previewImageUrl: row.preview_image_url || undefined,
        party: chars.map(c => ({ ...c, avatarUrl: c.avatarUrl || undefined })),
      };
    });
  },

  assignSessionToNamespace(sessionId: string, namespaceId: string): boolean {
    const db = getDb();
    const result = db.prepare('UPDATE sessions SET namespace_id = ? WHERE id = ?').run(namespaceId, sessionId);
    return result.changes > 0;
  },

  listSessionsInNamespace(namespaceId: string): { id: string; displayName: string; turn: number; createdAt: string }[] {
    const db = getDb();
    return db.prepare('SELECT id, displayName, turn, createdAt FROM sessions WHERE namespace_id = ? ORDER BY createdAt DESC').all(namespaceId) as { id: string; displayName: string; turn: number; createdAt: string }[];
  },

  countSessionsInNamespace(namespaceId: string): number {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE namespace_id = ?').get(namespaceId) as { count: number };
    return row.count;
  },

  async updateStorySummary(sessionId: string, summary: string): Promise<void> {
    const db = getDb();
    db.prepare('UPDATE sessions SET storySummary = ? WHERE id = ?').run(summary, sessionId);
  },
};
