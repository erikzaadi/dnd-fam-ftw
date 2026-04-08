import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
export class StateService {
    static db = null;
    static getDb() {
        if (!this.db) {
            this.db = new Database('./database.sqlite');
        }
        return this.db;
    }
    static async createSession(worldDescription, difficulty = 'normal') {
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
            difficulty
        };
    }
    static async getSession(id) {
        const db = this.getDb();
        const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
        if (!row) {
            return undefined;
        }
        const characters = db.prepare('SELECT * FROM characters WHERE sessionId = ?').all(id);
        for (const char of characters) {
            char.inventory = db.prepare('SELECT * FROM inventory WHERE characterId = ?').all(char.id);
            char.stats = { might: char.might, magic: char.magic, mischief: char.mischief };
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
                stats: c.stats,
                inventory: c.inventory
            })),
            activeCharacterId: row.activeCharacterId || "",
            npcs: [],
            quests: [],
            lastChoices: [],
            tone: row.tone,
            recentHistory: ["Adventure begins!"],
            displayName: row.displayName,
            difficulty: row.difficulty
        };
    }
    static async deleteSession(id) {
        const db = this.getDb();
        // Cleanup images
        const history = db.prepare('SELECT imageUrl FROM turn_history WHERE sessionId = ?').all(id);
        for (const row of history) {
            if (row.imageUrl) {
                const imagePath = path.join(import.meta.dirname, '../../', 'public', row.imageUrl);
                if (fs.existsSync(imagePath)) {
                    fs.unlinkSync(imagePath);
                }
            }
        }
        db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
        db.prepare('DELETE FROM turn_history WHERE sessionId = ?').run(id);
    }
    static async updateSession(id, state) {
        const db = this.getDb();
        db.prepare('UPDATE sessions SET scene = ?, sceneId = ?, turn = ?, activeCharacterId = ?, tone = ? WHERE id = ?')
            .run(state.scene, state.sceneId, state.turn, state.activeCharacterId, state.tone, id);
        // Simplistic sync for now, should handle deletions
        for (const char of state.party) {
            db.prepare('INSERT OR REPLACE INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, avatarUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .run(char.id, id, char.name, char.class, char.species, char.quirk, char.hp, char.max_hp, char.stats.might, char.stats.magic, char.stats.mischief, char.avatarUrl || null);
        }
    }
    static async listSessions() {
        const db = this.getDb();
        const rows = db.prepare('SELECT id, displayName FROM sessions ORDER BY createdAt DESC').all();
        return rows;
    }
    static async getSessionIdForCharacter(charId) {
        const db = this.getDb();
        const row = db.prepare('SELECT sessionId FROM characters WHERE id = ?').get(charId);
        return row ? row.sessionId : null;
    }
    static async listAllCharacters() {
        const db = this.getDb();
        const rows = db.prepare('SELECT * FROM characters').all();
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
    static async getTurnHistory(id) {
        const db = this.getDb();
        const rows = db.prepare('SELECT * FROM turn_history WHERE sessionId = ?').all(id);
        return rows.map(r => {
            const choices = db.prepare('SELECT * FROM turn_choices WHERE turnId = ?').all(r.id);
            return {
                narration: r.narration,
                imagePrompt: r.imagePrompt,
                imageSuggested: !!r.imageSuggested,
                imageUrl: r.imageUrl,
                characterId: r.characterId || undefined,
                choices: choices
            };
        });
    }
    static async addTurnResult(id, turn, characterId) {
        const db = this.getDb();
        const info = db.prepare('INSERT INTO turn_history (sessionId, characterId, narration, imagePrompt, imageSuggested, imageUrl) VALUES (?, ?, ?, ?, ?, ?)')
            .run(id, characterId, turn.narration, turn.imagePrompt, turn.imageSuggested ? 1 : 0, turn.imageUrl || null);
        const turnId = info.lastInsertRowid;
        for (const choice of turn.choices) {
            db.prepare('INSERT INTO turn_choices (turnId, label, difficulty, stat) VALUES (?, ?, ?, ?)')
                .run(turnId, choice.label, choice.difficulty, choice.stat);
        }
    }
}
