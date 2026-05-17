import { getDb } from '../persistence/database.js';
import type { Character } from '../types.js';

export const characterRepository = {
  async getSessionIdForCharacter(characterId: string): Promise<string | null> {
    const db = getDb();
    const row = db.prepare('SELECT sessionId FROM characters WHERE id = ?').get(characterId) as { sessionId: string } | undefined;
    return row ? row.sessionId : null;
  },

  async listAllCharacters(namespaceId: string): Promise<Character[]> {
    const db = getDb();
    const rows = db.prepare('SELECT c.* FROM characters c JOIN sessions s ON c.sessionId = s.id WHERE s.namespace_id = ?').all(namespaceId) as {
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
      buffs: string | null;
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
      buffs: char.buffs ? JSON.parse(char.buffs) : [],
      stats: { might: char.might, magic: char.magic, mischief: char.mischief },
      inventory: [],
    }));
  },

  updateAvatar(characterId: string, avatarUrl: string, avatarPrompt: string, avatarStorageKey: string, avatarStorageProvider: string): void {
    const db = getDb();
    db.prepare('UPDATE characters SET avatarUrl = ?, avatarPrompt = ?, avatar_storage_key = ?, avatar_storage_provider = ? WHERE id = ?')
      .run(avatarUrl, avatarPrompt, avatarStorageKey, avatarStorageProvider, characterId);
  },

  deleteCharacter(characterId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM inventory WHERE characterId = ?').run(characterId);
    db.prepare('DELETE FROM characters WHERE id = ?').run(characterId);
  },
};
