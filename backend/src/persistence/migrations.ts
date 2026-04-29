import type { Database as DB } from 'libsql';

export const migrate = (db: DB): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      scene TEXT NOT NULL,
      sceneId TEXT NOT NULL,
      worldDescription TEXT,
      turn INTEGER NOT NULL DEFAULT 1,
      activeCharacterId TEXT NOT NULL DEFAULT '',
      tone TEXT NOT NULL DEFAULT 'thrilling adventure',
      displayName TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT 'normal',
      gameMode TEXT NOT NULL DEFAULT 'balanced',
      savingsMode INTEGER NOT NULL DEFAULT 0,
      useLocalAI INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      class TEXT NOT NULL,
      species TEXT NOT NULL,
      quirk TEXT NOT NULL,
      hp INTEGER NOT NULL DEFAULT 10,
      max_hp INTEGER NOT NULL DEFAULT 10,
      might INTEGER NOT NULL DEFAULT 1,
      magic INTEGER NOT NULL DEFAULT 1,
      mischief INTEGER NOT NULL DEFAULT 1,
      avatarUrl TEXT,
      avatarPrompt TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      characterId TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      statBonuses TEXT
    );

    CREATE TABLE IF NOT EXISTS turn_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      characterId TEXT REFERENCES characters(id),
      narration TEXT NOT NULL,
      rollNarration TEXT,
      imagePrompt TEXT,
      imageSuggested INTEGER NOT NULL DEFAULT 0,
      imageUrl TEXT,
      actionAttempt TEXT,
      actionStat TEXT,
      actionSuccess INTEGER,
      actionRoll INTEGER
    );

    CREATE TABLE IF NOT EXISTS turn_choices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turnId INTEGER NOT NULL REFERENCES turn_history(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      stat TEXT NOT NULL
    );
  `);

  const turnCols = (db.prepare("PRAGMA table_info(turn_history)").all() as { name: string }[]).map(r => r.name);
  if (!turnCols.includes('actionAttempt')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionAttempt TEXT").run();
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionStat TEXT").run();
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionSuccess INTEGER").run();
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionRoll INTEGER").run();
  }
  if (!turnCols.includes('turnType')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN turnType TEXT NOT NULL DEFAULT 'normal'").run();
  }
  if (!turnCols.includes('actionStatBonus')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionStatBonus INTEGER").run();
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionItemBonus INTEGER").run();
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionIsCritical INTEGER").run();
  }
  if (!turnCols.includes('actionDifficultyTarget')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionDifficultyTarget INTEGER").run();
  }
  if (!turnCols.includes('actionImpact')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionImpact TEXT").run();
  }
  if (!turnCols.includes('image_storage_key')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN image_storage_key TEXT").run();
    db.prepare("ALTER TABLE turn_history ADD COLUMN image_storage_provider TEXT").run();
  }
  if (!turnCols.includes('rollNarration')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN rollNarration TEXT").run();
  }

  const choiceCols = (db.prepare("PRAGMA table_info(turn_choices)").all() as { name: string }[]).map(r => r.name);
  if (!choiceCols.includes('difficultyValue')) {
    db.prepare("ALTER TABLE turn_choices ADD COLUMN difficultyValue INTEGER").run();
  }

  const charCols = (db.prepare("PRAGMA table_info(characters)").all() as { name: string }[]).map(r => r.name);
  if (!charCols.includes('avatarPrompt')) {
    db.prepare("ALTER TABLE characters ADD COLUMN avatarPrompt TEXT").run();
  }
  if (!charCols.includes('gender')) {
    db.prepare("ALTER TABLE characters ADD COLUMN gender TEXT").run();
  }
  if (!charCols.includes('status')) {
    db.prepare("ALTER TABLE characters ADD COLUMN status TEXT NOT NULL DEFAULT 'active'").run();
  }
  if (!charCols.includes('avatar_storage_key')) {
    db.prepare("ALTER TABLE characters ADD COLUMN avatar_storage_key TEXT").run();
    db.prepare("ALTER TABLE characters ADD COLUMN avatar_storage_provider TEXT").run();
  }

  const invCols = (db.prepare("PRAGMA table_info(inventory)").all() as { name: string }[]).map(r => r.name);
  if (!invCols.includes('statBonuses')) {
    db.prepare("ALTER TABLE inventory ADD COLUMN statBonuses TEXT").run();
  }
  if (!invCols.includes('itemId')) {
    db.prepare("ALTER TABLE inventory ADD COLUMN itemId TEXT").run();
  }
  if (!invCols.includes('healValue')) {
    db.prepare("ALTER TABLE inventory ADD COLUMN healValue INTEGER").run();
  }
  if (!invCols.includes('transferable')) {
    db.prepare("ALTER TABLE inventory ADD COLUMN transferable INTEGER").run();
  }
  if (!invCols.includes('consumable')) {
    db.prepare("ALTER TABLE inventory ADD COLUMN consumable INTEGER").run();
  }

  const sessionCols = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map(r => r.name);
  if (!sessionCols.includes('savingsMode')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN savingsMode INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!sessionCols.includes('useLocalAI')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN useLocalAI INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!sessionCols.includes('interventionUsed')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN interventionUsed INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!sessionCols.includes('storySummary')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN storySummary TEXT NOT NULL DEFAULT ''").run();
  }
  if (!sessionCols.includes('namespace_id')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN namespace_id TEXT NOT NULL DEFAULT 'local'").run();
  }
  if (!sessionCols.includes('gameMode')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN gameMode TEXT NOT NULL DEFAULT 'balanced'").run();
  }
  if (!sessionCols.includes('dm_prep')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN dm_prep TEXT").run();
  }
  if (!sessionCols.includes('dm_prep_image_brief')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN dm_prep_image_brief TEXT").run();
  }

  if (!turnCols.includes('currentTensionLevel')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN currentTensionLevel TEXT").run();
  }
  if (!turnCols.includes('hpChanges')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN hpChanges TEXT").run();
  }
  if (!turnCols.includes('inventoryChanges')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN inventoryChanges TEXT").run();
  }

  if (!choiceCols.includes('narration')) {
    db.prepare("ALTER TABLE turn_choices ADD COLUMN narration TEXT").run();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS namespaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      namespace_id TEXT NOT NULL REFERENCES namespaces(id),
      role TEXT NOT NULL DEFAULT 'member',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_namespaces (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, namespace_id)
    );

    CREATE TABLE IF NOT EXISTS invite_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tts_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      namespace_id TEXT NOT NULL REFERENCES namespaces(id),
      provider TEXT NOT NULL,
      voice TEXT NOT NULL,
      character_count INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Always ensure the local (no-auth) namespace exists.
  db.prepare("INSERT OR IGNORE INTO namespaces (id, name) VALUES ('local', 'Local')").run();

  // Backfill user_namespaces from existing users.namespace_id.
  db.prepare("INSERT OR IGNORE INTO user_namespaces (user_id, namespace_id) SELECT id, namespace_id FROM users").run();

  const namespaceCols = (db.prepare("PRAGMA table_info(namespaces)").all() as { name: string }[]).map(r => r.name);
  if (!namespaceCols.includes('max_sessions')) {
    db.prepare("ALTER TABLE namespaces ADD COLUMN max_sessions INTEGER").run();
    db.prepare("ALTER TABLE namespaces ADD COLUMN max_turns INTEGER").run();
  }

  const charColsFull = (db.prepare("PRAGMA table_info(characters)").all() as { name: string }[]).map(r => r.name);
  if (!charColsFull.includes('history')) {
    db.prepare("ALTER TABLE characters ADD COLUMN history TEXT").run();
  }

  const sessionColsFull = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map(r => r.name);
  if (!sessionColsFull.includes('rescues_used')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN rescues_used INTEGER NOT NULL DEFAULT 0").run();
    // Backfill: old sessions with interventionUsed=1 have had 1 rescue.
    db.prepare("UPDATE sessions SET rescues_used = 1 WHERE interventionUsed = 1").run();
  }
  if (!sessionColsFull.includes('game_over')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN game_over INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!sessionColsFull.includes('preview_image_url')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN preview_image_url TEXT").run();
  }
};
