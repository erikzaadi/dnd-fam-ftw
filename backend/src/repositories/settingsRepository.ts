import { getDb } from '../persistence/database.js';

export type SettingRow = {
  key: string;
  value: string;
};

export const settingsRepository = {
  getNamespaceSettings(namespaceId: string): SettingRow[] {
    return getDb().prepare('SELECT key, value FROM namespace_settings WHERE namespace_id = ?')
      .all(namespaceId) as SettingRow[];
  },

  saveNamespaceSettings(namespaceId: string, rows: SettingRow[]): void {
    const db = getDb();
    const upsert = db.prepare('INSERT OR REPLACE INTO namespace_settings (namespace_id, key, value) VALUES (?, ?, ?)');
    db.transaction((items: SettingRow[]) => {
      for (const row of items) {
        upsert.run(namespaceId, row.key, row.value);
      }
    })(rows);
  },

  deleteNamespaceSettings(namespaceId: string): void {
    getDb().prepare('DELETE FROM namespace_settings WHERE namespace_id = ?').run(namespaceId);
  },
};
