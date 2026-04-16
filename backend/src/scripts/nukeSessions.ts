/**
 * Nuke script: deletes all sessions, characters, inventory, and turn history from the DB.
 * Run from backend/: npx tsx src/scripts/nukeSessions.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', '..', 'database.sqlite'));

const tables = ['turn_choices', 'turn_history', 'inventory', 'characters', 'history', 'sessions'];

const nuke = db.transaction(() => {
  for (const table of tables) {
    const { changes } = db.prepare(`DELETE FROM ${table}`).run();
    console.log(`- ${table}: ${changes} rows deleted`);
  }
});

console.log('Nuking all sessions...');
nuke();
console.log('Done.');
