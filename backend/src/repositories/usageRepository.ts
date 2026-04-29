import { getDb } from '../persistence/database.js';

export type TtsUsage = {
  requestCount: number;
  characterCount: number;
};

export const usageRepository = {
  recordTtsUsage(namespaceId: string, voice: string, characterCount: number, provider: string = 'openai'): void {
    const db = getDb();
    db.prepare('INSERT INTO tts_usage (namespace_id, provider, voice, character_count) VALUES (?, ?, ?, ?)')
      .run(namespaceId, provider, voice, characterCount);
  },

  getTtsUsage(namespaceId: string): TtsUsage {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as requestCount, COALESCE(SUM(character_count), 0) as characterCount FROM tts_usage WHERE namespace_id = ?')
      .get(namespaceId) as TtsUsage;
    return { requestCount: row.requestCount, characterCount: row.characterCount };
  },
};
