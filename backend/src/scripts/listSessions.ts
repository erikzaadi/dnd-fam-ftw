/**
 * List script: prints all sessions, characters, inventory and turn history from the DB.
 * Run from backend/: npx tsx src/scripts/listSessions.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', '..', 'database.sqlite'), { readonly: true });

const jsonMode = process.argv.includes('--json');

const sessions = db.prepare('SELECT * FROM sessions').all();
const characters = db.prepare('SELECT * FROM characters').all();
const inventory = db.prepare('SELECT * FROM inventory').all();
const history = db.prepare('SELECT * FROM turn_history').all();

if (jsonMode) {
  console.log(JSON.stringify({ sessions, characters, inventory, history }, null, 2));
} else {
  console.log('=== SESSIONS ===');
  console.table(sessions);

  console.log('\n=== CHARACTERS ===');
  console.table(characters);

  console.log('\n=== INVENTORY ===');
  console.table(inventory);

  console.log('\n=== TURN HISTORY ===');
  console.table(history);
}
