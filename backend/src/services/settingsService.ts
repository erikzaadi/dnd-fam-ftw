import Database from 'libsql';
import type { AppSettings } from '../types.js';

export type { AppSettings };

const DEFAULTS: AppSettings = {
  imagesEnabled: true,
};

let _db: ReturnType<typeof Database> | null = null;
const db = () => {
  if (!_db) {
    _db = new Database('./database.sqlite');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }
  return _db;
};

export class SettingsService {
  static get(): AppSettings {
    const rows = db().prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[];
    const stored = Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
    return {
      ...DEFAULTS,
      ...(typeof stored.imagesEnabled === 'boolean' && { imagesEnabled: stored.imagesEnabled }),
    };
  }

  static save(settings: Partial<AppSettings>): AppSettings {
    const next = { ...this.get(), ...settings };
    const upsert = db().prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)');
    const saveAll = db().transaction((s: AppSettings) => {
      upsert.run('imagesEnabled', JSON.stringify(s.imagesEnabled));
    });
    saveAll(next);
    return next;
  }
}
