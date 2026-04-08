import Database, { Database as DB } from 'better-sqlite3';
import { SessionState, Character, TurnResult, InventoryItem } from '../types.js';
import fs from 'fs';
import path from 'path';

export class StateService {
  private static db: DB | null = null;

  private static getDb() {
    if (!this.db) {
      this.db = new Database('./database.sqlite');
      this.migrate(this.db);
    }
    return this.db;
  }

  private static migrate(db: DB) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        scene TEXT NOT NULL,
        sceneId TEXT NOT NULL,
        worldDescription TEXT,
        turn INTEGER NOT NULL DEFAULT 1,
        activeCharacterId TEXT NOT NULL DEFAULT '',
        tone TEXT NOT NULL DEFAULT 'thrilling adventure',
        displayName TEXT NOT NULL DEFAULT '',
        difficulty TEXT NOT NULL DEFAULT 'normal',
        savingsMode INTEGER NOT NULL DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        class TEXT NOT NULL,
        species TEXT NOT NULL,
        quirk TEXT NOT NULL,
        hp INTEGER NOT NULL DEFAULT 10,
        max_hp INTEGER NOT NULL DEFAULT 10,
        might INTEGER NOT NULL DEFAULT 1,
        magic INTEGER NOT NULL DEFAULT 1,
        mischief INTEGER NOT NULL DEFAULT 1,
        avatarUrl TEXT,
        avatarPrompt TEXT
      );

      CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        characterId TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        statBonuses TEXT
      );

      CREATE TABLE IF NOT EXISTS turn_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        characterId TEXT REFERENCES characters(id),
        narration TEXT NOT NULL,
        imagePrompt TEXT,
        imageSuggested INTEGER NOT NULL DEFAULT 0,
        imageUrl TEXT,
        actionAttempt TEXT,
        actionStat TEXT,
        actionSuccess INTEGER,
        actionRoll INTEGER
      );

      CREATE TABLE IF NOT EXISTS turn_choices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        turnId INTEGER NOT NULL REFERENCES turn_history(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        stat TEXT NOT NULL
      );
    `);

    const turnCols = (db.prepare("PRAGMA table_info(turn_history)").all() as { name: string }[]).map(r => r.name);
    if (!turnCols.includes('actionAttempt')) {
      db.prepare("ALTER TABLE turn_history ADD COLUMN actionAttempt TEXT").run();
      db.prepare("ALTER TABLE turn_history ADD COLUMN actionStat TEXT").run();
      db.prepare("ALTER TABLE turn_history ADD COLUMN actionSuccess INTEGER").run();
      db.prepare("ALTER TABLE turn_history ADD COLUMN actionRoll INTEGER").run();
    }

    const charCols = (db.prepare("PRAGMA table_info(characters)").all() as { name: string }[]).map(r => r.name);
    if (!charCols.includes('avatarPrompt')) {
      db.prepare("ALTER TABLE characters ADD COLUMN avatarPrompt TEXT").run();
    }

    const invCols = (db.prepare("PRAGMA table_info(inventory)").all() as { name: string }[]).map(r => r.name);
    if (!invCols.includes('statBonuses')) {
      db.prepare("ALTER TABLE inventory ADD COLUMN statBonuses TEXT").run();
    }

    const sessionCols = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map(r => r.name);
    if (!sessionCols.includes('savingsMode')) {
      db.prepare("ALTER TABLE sessions ADD COLUMN savingsMode INTEGER NOT NULL DEFAULT 0").run();
    }
  }

  public static async createSession(worldDescription?: string, difficulty: string = 'normal'): Promise<SessionState> {
    const db = this.getDb();
    const id = Math.random().toString(36).substring(7);

    // Generate Display Name (using the same prompt as before)
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: `Give me a short, evocative name (max 3 words) for a story setting based on: ${worldDescription || 'a random world'}` }]
        })
    });
    if (!response.ok) {
      const err = new Error('OpenAI API error') as Error & { status: number };
      err.status = response.status;
      throw err;
    }
    const result = await response.json();
    const displayName = result.choices[0].message.content.replace(/"/g, '');

    db.prepare('INSERT INTO sessions (id, scene, sceneId, worldDescription, turn, tone, displayName, difficulty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, "A New World", "start-1", worldDescription || null, 1, "thrilling adventure", displayName, difficulty);

    return {
      id,
      scene: "A New World",
      sceneId: "start-1",
      worldDescription,
      turn: 1,
      party: [],
      activeCharacterId: "",
      npcs: [],
      quests: [],
      lastChoices: [],
      tone: "thrilling adventure",
      recentHistory: ["Adventure begins!"],
      displayName,
      difficulty,
      savingsMode: false
    };
  }  public static async getSession(id: string): Promise<SessionState | undefined> {
    const db = this.getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as {
      id: string;
      scene: string;
      sceneId: string;
      worldDescription: string | null;
      turn: number;
      activeCharacterId: string;
      tone: string;
      displayName: string;
      difficulty: string;
      savingsMode: number;
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
    }[];
    for (const char of characters) {
      const rawInv = db.prepare('SELECT * FROM inventory WHERE characterId = ?').all(char.id) as { name: string; description: string; statBonuses: string | null }[];
      (char as unknown as { inventory: InventoryItem[] }).inventory = rawInv.map(i => ({
        name: i.name,
        description: i.description,
        statBonuses: i.statBonuses ? JSON.parse(i.statBonuses) : undefined,
      }));
      (char as unknown as { stats: { might: number, magic: number, mischief: number } }).stats = { might: char.might, magic: char.magic, mischief: char.mischief };
    }

    return {
      id: row.id,
      scene: row.scene,
      sceneId: row.sceneId,
      worldDescription: row.worldDescription || undefined,
      turn: row.turn,
      party: characters.map(c => ({
        id: c.id,
        name: c.name,
        class: c.class,
        species: c.species,
        quirk: c.quirk,
        hp: c.hp,
        max_hp: c.max_hp,
        avatarUrl: c.avatarUrl || undefined,
        avatarPrompt: c.avatarPrompt || undefined,
        stats: (c as unknown as { stats: { might: number, magic: number, mischief: number } }).stats,
        inventory: (c as unknown as { inventory: InventoryItem[] }).inventory
      })),
      activeCharacterId: row.activeCharacterId || "",
      npcs: [],
      quests: [],
      lastChoices: [],
      tone: row.tone,
      recentHistory: ["Adventure begins!"],
      displayName: row.displayName,
      difficulty: row.difficulty,
      savingsMode: !!row.savingsMode
    };
  }

  public static async setSavingsMode(id: string, enabled: boolean): Promise<void> {
    const db = this.getDb();
    db.prepare('UPDATE sessions SET savingsMode = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  }

  public static async deleteSession(id: string): Promise<void> {
    const db = this.getDb();
    const imagesDir = path.join(import.meta.dirname, '../../public/images');

    const deleteImageFile = (url: string | null) => {
      if (!url) {return;}
      const filePath = path.join(imagesDir, path.basename(url));
      if (fs.existsSync(filePath)) {fs.unlinkSync(filePath);}
    };

    // Delete scene images
    const history = db.prepare('SELECT imageUrl FROM turn_history WHERE sessionId = ?').all(id) as { imageUrl: string | null }[];
    for (const row of history) {deleteImageFile(row.imageUrl);}

    // Delete avatar images
    const characters = db.prepare('SELECT avatarUrl FROM characters WHERE sessionId = ?').all(id) as { avatarUrl: string | null }[];
    for (const char of characters) {deleteImageFile(char.avatarUrl);}

    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    db.prepare('DELETE FROM turn_history WHERE sessionId = ?').run(id);
  }

  public static async updateSession(id: string, state: SessionState): Promise<void> {
    const db = this.getDb();
    db.prepare('UPDATE sessions SET scene = ?, sceneId = ?, turn = ?, activeCharacterId = ?, tone = ? WHERE id = ?')
      .run(state.scene, state.sceneId, state.turn, state.activeCharacterId, state.tone, id);

    for (const char of state.party) {
        db.prepare('INSERT OR REPLACE INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, avatarUrl, avatarPrompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(char.id, id, char.name, char.class, char.species, char.quirk, char.hp, char.max_hp, char.stats.might, char.stats.magic, char.stats.mischief, char.avatarUrl || null, char.avatarPrompt || null);

        db.prepare('DELETE FROM inventory WHERE characterId = ?').run(char.id);
        for (const item of (char.inventory ?? [])) {
            db.prepare('INSERT INTO inventory (characterId, name, description, statBonuses) VALUES (?, ?, ?, ?)').run(char.id, item.name, item.description, item.statBonuses ? JSON.stringify(item.statBonuses) : null);
        }
    }
  }

  public static async listSessions(): Promise<{ id: string, displayName: string }[]> {
    const db = this.getDb();
    const rows = db.prepare('SELECT id, displayName FROM sessions ORDER BY createdAt DESC').all() as { id: string, displayName: string }[];
    return rows;
  }

  public static async getSessionIdForCharacter(charId: string): Promise<string | null> {
    const db = this.getDb();
    const row = db.prepare('SELECT sessionId FROM characters WHERE id = ?').get(charId) as { sessionId: string } | undefined;
    return row ? row.sessionId : null;
  }

  public static async listAllCharacters(): Promise<Character[]> {
    const db = this.getDb();
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
    }[];
    return rows.map(char => ({
        id: char.id,
        name: char.name,
        class: char.class,
        species: char.species,
        quirk: char.quirk,
        hp: char.hp,
        max_hp: char.max_hp,
        avatarUrl: char.avatarUrl || undefined,
        stats: { might: char.might, magic: char.magic, mischief: char.mischief },
        inventory: []
    }));
  }

  public static async getTurnHistory(id: string): Promise<TurnResult[]> {
    const db = this.getDb();
    const rows = db.prepare('SELECT * FROM turn_history WHERE sessionId = ?').all(id) as {
      id: number;
      narration: string;
      imagePrompt: string | null;
      imageSuggested: number;
      imageUrl: string | null;
      characterId: string | null;
      actionAttempt: string | null;
      actionStat: string | null;
      actionSuccess: number | null;
      actionRoll: number | null;
    }[];

    return rows.map(r => {
        const choices = db.prepare('SELECT * FROM turn_choices WHERE turnId = ?').all(r.id) as {
            label: string;
            difficulty: 'easy' | 'normal' | 'hard';
            stat: 'might' | 'magic' | 'mischief';
        }[];
        const lastAction = r.actionAttempt ? {
            actionAttempt: r.actionAttempt,
            actionResult: {
                success: !!r.actionSuccess,
                roll: r.actionRoll ?? 0,
                statUsed: (r.actionStat ?? 'none') as 'might' | 'magic' | 'mischief' | 'none'
            }
        } : null;
        return {
            narration: r.narration,
            imagePrompt: r.imagePrompt,
            imageSuggested: !!r.imageSuggested,
            imageUrl: r.imageUrl,
            characterId: r.characterId || undefined,
            choices,
            lastAction
        };
    });
  }
  public static async addTurnResult(id: string, turn: TurnResult, characterId: string | null): Promise<void> {
    const db = this.getDb();
    const action = turn.lastAction ?? null;
    const info = db.prepare('INSERT INTO turn_history (sessionId, characterId, narration, imagePrompt, imageSuggested, imageUrl, actionAttempt, actionStat, actionSuccess, actionRoll) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        id, characterId || null, turn.narration, turn.imagePrompt, turn.imageSuggested ? 1 : 0, turn.imageUrl || null,
        action?.actionAttempt ?? null,
        action?.actionResult?.statUsed ?? null,
        action?.actionResult?.success ? 1 : 0,
        action?.actionResult?.roll ?? null
      );

    const turnId = info.lastInsertRowid;
    for (const choice of (turn.choices ?? [])) {
        db.prepare('INSERT INTO turn_choices (turnId, label, difficulty, stat) VALUES (?, ?, ?, ?)')
          .run(turnId, choice.label, choice.difficulty, choice.stat);
    }
  }
}
