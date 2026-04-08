import Database from 'better-sqlite3';
import { readFileSync, writeFileSync } from 'fs';

const db = new Database('/Users/erikzaadi/Code/Opensource/mine/dnd-fam-ftw/backend/database.sqlite');

// Rename old table first
try {
  db.exec('ALTER TABLE sessions RENAME TO sessions_old');
} catch (e) {
  console.log('sessions_old already exists');
}

// Initialize new tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    scene TEXT,
    sceneId TEXT,
    worldDescription TEXT,
    turn INTEGER,
    activeCharacterId TEXT,
    tone TEXT
  );
  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    sessionId TEXT,
    name TEXT,
    class TEXT,
    species TEXT,
    quirk TEXT,
    hp INTEGER,
    max_hp INTEGER,
    might INTEGER,
    magic INTEGER,
    mischief INTEGER,
    FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    characterId TEXT,
    name TEXT,
    description TEXT,
    FOREIGN KEY(characterId) REFERENCES characters(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS turn_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId TEXT,
    characterId TEXT,
    narration TEXT,
    imagePrompt TEXT,
    imageSuggested BOOLEAN,
    imageUrl TEXT,
    FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(characterId) REFERENCES characters(id)
  );
  CREATE TABLE IF NOT EXISTS turn_choices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turnId INTEGER,
    label TEXT,
    difficulty TEXT,
    stat TEXT,
    FOREIGN KEY(turnId) REFERENCES turn_history(id) ON DELETE CASCADE
  );
`);

// Migration logic
const oldSessions = db.prepare('SELECT id, data FROM sessions_old').all();

for (const old of oldSessions) {
  const session = JSON.parse(old.data);
  db.prepare('INSERT INTO sessions (id, scene, sceneId, worldDescription, turn, activeCharacterId, tone) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(session.id, session.scene, session.sceneId, session.worldDescription || null, session.turn, session.activeCharacterId, session.tone);
  
  for (const char of session.party) {
    db.prepare('INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(char.id, session.id, char.name, char.class, char.species, char.quirk, char.hp, char.max_hp, char.stats.might, char.stats.magic, char.stats.mischief);
    
    for (const item of char.inventory) {
      db.prepare('INSERT INTO inventory (characterId, name, description) VALUES (?, ?, ?)')
        .run(char.id, item.name, item.description);
    }
  }
}

console.log('Migration complete');
