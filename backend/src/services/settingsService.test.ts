import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, initializeDatabase } from '../persistence/database.js';
import { SettingsService } from './settingsService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-settings-test-${Date.now()}.sqlite`);

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  initializeDatabase();
  getDb().prepare("INSERT OR IGNORE INTO namespaces (id, name) VALUES ('ns-a', 'A'), ('ns-b', 'B')").run();
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

describe('SettingsService', () => {
  it('returns defaults when the namespace has no stored settings', () => {
    expect(SettingsService.get('local')).toEqual({ imagesEnabled: true });
  });

  it('does not include defaultUseLocalAI in returned settings', () => {
    expect(SettingsService.get('local')).not.toHaveProperty('defaultUseLocalAI');
  });

  it('persists imagesEnabled per namespace', () => {
    SettingsService.save('ns-a', { imagesEnabled: false });
    expect(SettingsService.get('ns-a').imagesEnabled).toBe(false);
  });

  it('does not let one namespace change another namespace settings', () => {
    SettingsService.save('ns-a', { imagesEnabled: false });
    expect(SettingsService.get('ns-b').imagesEnabled).toBe(true);
    expect(SettingsService.get('local').imagesEnabled).toBe(true);
  });
});
