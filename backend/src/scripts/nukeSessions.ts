/**
 * Nuke script: deletes all sessions, characters, inventory, and turn history from the DB.
 * Run from backend/: npx tsx src/scripts/nukeSessions.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { getConfig } from '../config/env.js';
import { StateService } from '../services/stateService.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env') });

// Ensure DB exists and migrations have run
StateService.initialize();

const dbPath = path.resolve(getConfig().SQLITE_DB_PATH);
const db = new Database(dbPath);

const tables = ['turn_choices', 'turn_history', 'inventory', 'characters', 'history', 'sessions'];

const nuke = db.transaction(() => {
  for (const table of tables) {
    const { changes } = db.prepare(`DELETE FROM ${table}`).run();
    console.log(`- ${table}: ${changes} rows deleted`);
  }
});

console.log(`Nuking all sessions in ${dbPath}...`);
nuke();
console.log('Done.');
