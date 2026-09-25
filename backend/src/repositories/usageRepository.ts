import { getDb } from '../persistence/database.js';

export type TtsUsage = {
  requestCount: number;
  characterCount: number;
};

export type ProviderUsageRecord = {
  namespaceId: string | null;
  userId: string | null;
  sessionId: string | null;
  kind: 'text' | 'image' | 'tts';
  endpoint: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  ttsCharacters: number | null;
  imageCount: number | null;
  success: boolean;
  estimatedCostUsd: number;
};

export type ProviderUsageTotals = {
  textCalls: number;
  imageCalls: number;
  ttsCharacters: number;
  estimatedCostUsd: number;
};

// SQLite CURRENT_TIMESTAMP format (UTC), so created_at compares as text.
export const toSqliteTimestamp = (date: Date): string => date.toISOString().slice(0, 19).replace('T', ' ');

const TOTALS_SELECT = `
  SELECT
    COALESCE(SUM(CASE WHEN kind = 'text' THEN 1 ELSE 0 END), 0) AS textCalls,
    COALESCE(SUM(CASE WHEN kind = 'image' THEN COALESCE(image_count, 1) ELSE 0 END), 0) AS imageCalls,
    COALESCE(SUM(tts_characters), 0) AS ttsCharacters,
    COALESCE(SUM(estimated_cost_usd), 0) AS estimatedCostUsd
  FROM provider_usage`;

export const usageRepository = {
  recordProviderUsage(record: ProviderUsageRecord): void {
    getDb().prepare(`
      INSERT INTO provider_usage (
        namespace_id, user_id, session_id, kind, endpoint, model,
        input_tokens, output_tokens, tts_characters, image_count, success, estimated_cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.namespaceId, record.userId, record.sessionId, record.kind, record.endpoint, record.model,
      record.inputTokens, record.outputTokens, record.ttsCharacters, record.imageCount,
      record.success ? 1 : 0, record.estimatedCostUsd,
    );
  },

  getNamespaceUsageSince(namespaceId: string, since: Date): ProviderUsageTotals {
    return getDb().prepare(`${TOTALS_SELECT} WHERE namespace_id = ? AND created_at >= ?`)
      .get(namespaceId, toSqliteTimestamp(since)) as ProviderUsageTotals;
  },

  getTotalUsageSince(since: Date): ProviderUsageTotals {
    return getDb().prepare(`${TOTALS_SELECT} WHERE created_at >= ?`)
      .get(toSqliteTimestamp(since)) as ProviderUsageTotals;
  },

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
