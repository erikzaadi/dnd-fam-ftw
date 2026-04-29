import { getDb } from '../persistence/database.js';
import type { Character } from '../types.js';

export const characterRepository = {
  async getSessionIdForCharacter(characterId: string): Promise<string | null> {
    const db = getDb();
    const row = db.prepare('SELECT sessionId FROM characters WHERE id = ?').get(characterId) as { sessionId: string } | undefined;
    return row ? row.sessionId : null;
  },

  async listAllCharacters(): Promise<Character[]> {
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
      inventory: [],
    }));
  },

  deleteCharacter(characterId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM inventory WHERE characterId = ?').run(characterId);
    db.prepare('DELETE FROM characters WHERE id = ?').run(characterId);
  },
};
