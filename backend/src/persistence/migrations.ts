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
  if (!turnCols.includes('actionHelperBonus')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionHelperBonus INTEGER").run();
  }
  if (!turnCols.includes('actionHelperCharacterName')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionHelperCharacterName TEXT").run();
  }
  if (!turnCols.includes('actionChoiceItemBonus')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionChoiceItemBonus INTEGER").run();
  }
  if (!turnCols.includes('actionChoiceItemName')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionChoiceItemName TEXT").run();
  }
  if (!turnCols.includes('actionChoiceItemOwnerName')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionChoiceItemOwnerName TEXT").run();
  }
  if (!turnCols.includes('actionCharacterBonus')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionCharacterBonus INTEGER").run();
  }
  if (!turnCols.includes('actionCharacterBonusLabel')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionCharacterBonusLabel TEXT").run();
  }
  if (!turnCols.includes('actionBuffBonus')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionBuffBonus INTEGER").run();
  }
  if (!turnCols.includes('actionBuffBonusLabel')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN actionBuffBonusLabel TEXT").run();
  }
  if (!turnCols.includes('image_storage_key')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN image_storage_key TEXT").run();
    db.prepare("ALTER TABLE turn_history ADD COLUMN image_storage_provider TEXT").run();
  }
  if (!turnCols.includes('rollNarration')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN rollNarration TEXT").run();
  }
  if (!turnCols.includes('createdAt')) {
    // libsql rejects a non-constant ALTER TABLE ADD COLUMN default (e.g. DEFAULT CURRENT_TIMESTAMP),
    // so add the column bare, backfill existing rows, then stamp future inserts via trigger.
    db.prepare("ALTER TABLE turn_history ADD COLUMN createdAt DATETIME").run();
    db.prepare("UPDATE turn_history SET createdAt = CURRENT_TIMESTAMP WHERE createdAt IS NULL").run();
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS turn_history_set_created_at
    AFTER INSERT ON turn_history
    FOR EACH ROW WHEN NEW.createdAt IS NULL
    BEGIN
      UPDATE turn_history SET createdAt = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `);

  const choiceCols = (db.prepare("PRAGMA table_info(turn_choices)").all() as { name: string }[]).map(r => r.name);
  if (!choiceCols.includes('difficultyValue')) {
    db.prepare("ALTER TABLE turn_choices ADD COLUMN difficultyValue INTEGER").run();
  }
  if (!choiceCols.includes('riddleAnswer')) {
    db.prepare("ALTER TABLE turn_choices ADD COLUMN riddleAnswer TEXT").run();
  }
  if (!choiceCols.includes('riddleCorrect')) {
    db.prepare("ALTER TABLE turn_choices ADD COLUMN riddleCorrect INTEGER").run();
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
  if (!charCols.includes('buffs')) {
    db.prepare("ALTER TABLE characters ADD COLUMN buffs TEXT").run();
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
  if (!invCols.includes('tags')) {
    db.prepare("ALTER TABLE inventory ADD COLUMN tags TEXT").run();
  }
  if (!invCols.includes('effect')) {
    db.prepare("ALTER TABLE inventory ADD COLUMN effect TEXT").run();
  }
  if (!invCols.includes('charges')) {
    db.prepare("ALTER TABLE inventory ADD COLUMN charges INTEGER").run();
  }
  if (!invCols.includes('condition')) {
    db.prepare("ALTER TABLE inventory ADD COLUMN condition TEXT").run();
  }
  if (!invCols.includes('boundToCharacterId')) {
    db.prepare("ALTER TABLE inventory ADD COLUMN boundToCharacterId TEXT").run();
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
  if (!turnCols.includes('narrationRetried')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN narrationRetried INTEGER").run();
  }
  if (!turnCols.includes('narrationFailed')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN narrationFailed INTEGER").run();
  }
  if (!turnCols.includes('choicesFailed')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN choicesFailed INTEGER").run();
  }
  if (!turnCols.includes('narrationValidationError')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN narrationValidationError TEXT").run();
  }
  if (!turnCols.includes('narrationRetryValidationError')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN narrationRetryValidationError TEXT").run();
  }
  if (!turnCols.includes('encounterId')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN encounterId TEXT").run();
  }
  if (!turnCols.includes('encounterEnemyChanges')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN encounterEnemyChanges TEXT").run();
  }
  if (!turnCols.includes('buffChanges')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN buffChanges TEXT").run();
  }

  if (!choiceCols.includes('narration')) {
    db.prepare("ALTER TABLE turn_choices ADD COLUMN narration TEXT").run();
  }
  if (!choiceCols.includes('flavor')) {
    db.prepare("ALTER TABLE turn_choices ADD COLUMN flavor TEXT").run();
  }
  if (!choiceCols.includes('helperCharacterName')) {
    db.prepare("ALTER TABLE turn_choices ADD COLUMN helperCharacterName TEXT").run();
  }
  if (!choiceCols.includes('itemOwnerName')) {
    db.prepare("ALTER TABLE turn_choices ADD COLUMN itemOwnerName TEXT").run();
  }
  if (!choiceCols.includes('itemName')) {
    db.prepare("ALTER TABLE turn_choices ADD COLUMN itemName TEXT").run();
  }
  if (!choiceCols.includes('environmentFeature')) {
    db.prepare("ALTER TABLE turn_choices ADD COLUMN environmentFeature TEXT").run();
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

  const sessionColsFinal = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map(r => r.name);
  if (!sessionColsFinal.includes('encounter_state')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN encounter_state TEXT").run();
  }
  if (!sessionColsFinal.includes('dm_prep_encounters')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN dm_prep_encounters TEXT").run();
  }
  if (!sessionColsFinal.includes('past_encounters')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN past_encounters TEXT").run();
  }

  const sessionColsCompiled = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map(r => r.name);
  if (!sessionColsCompiled.includes('compiled_dm_prep')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN compiled_dm_prep TEXT").run();
  }

  const sessionColsOrigin = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map(r => r.name);
  if (!sessionColsOrigin.includes('origin_story')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN origin_story TEXT").run();
    db.prepare("ALTER TABLE sessions ADD COLUMN origin_story_image_url TEXT").run();
    db.prepare("ALTER TABLE sessions ADD COLUMN origin_story_image_storage_key TEXT").run();
    db.prepare("ALTER TABLE sessions ADD COLUMN origin_story_image_storage_provider TEXT").run();
    db.prepare("ALTER TABLE sessions ADD COLUMN origin_story_generated_at TEXT").run();
  }

  const userColsFull = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map(r => r.name);
  if (!userColsFull.includes('lastLogin')) {
    db.prepare("ALTER TABLE users ADD COLUMN lastLogin DATETIME").run();
  }

  // Session revision: bumped by every authoritative gameplay or settings mutation.
  // Clients send it back as expectedRevision so stale submissions are rejected.
  const sessionColsRevision = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map(r => r.name);
  if (!sessionColsRevision.includes('revision')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0").run();
  }
  // Turn number the stored story summary was built from, so late summaries never overwrite newer ones.
  if (!sessionColsRevision.includes('story_summary_turn')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN story_summary_turn INTEGER NOT NULL DEFAULT 0").run();
  }

  // Durable operation ledger: one row per accepted client request. The partial unique
  // index is the per-session mutation guard (at most one accepted/running operation).
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_operations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      namespace_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT,
      base_revision INTEGER NOT NULL,
      result_revision INTEGER,
      turn_id INTEGER,
      error_code TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_operations_request ON session_operations(session_id, request_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_operations_active ON session_operations(session_id) WHERE status IN ('accepted', 'running');
  `);

  const turnColsOperation = (db.prepare("PRAGMA table_info(turn_history)").all() as { name: string }[]).map(r => r.name);
  if (!turnColsOperation.includes('operation_id')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN operation_id TEXT").run();
  }

  // Adventure lifecycle. The column default is deliberately 'long_lived': existing
  // sessions must never be retroactively rushed toward an ending. New sessions get
  // 'one_evening' from the creation code instead (see sessionRepository.createSession).
  const sessionColsAdventure = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map(r => r.name);
  if (!sessionColsAdventure.includes('adventure_format')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN adventure_format TEXT NOT NULL DEFAULT 'long_lived'").run();
  }
  if (!sessionColsAdventure.includes('adventure_status')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN adventure_status TEXT NOT NULL DEFAULT 'active'").run();
  }
  // Public progress JSON (phase, counters, participating heroes). Written only by commits.
  if (!sessionColsAdventure.includes('adventure_arc')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN adventure_arc TEXT").run();
  }
  // Public chapter objective, stored once per chapter.
  if (!sessionColsAdventure.includes('adventure_objective')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN adventure_objective TEXT").run();
  }
  // Private chapter payoff / DM intent. Never sent to clients.
  if (!sessionColsAdventure.includes('adventure_plan')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN adventure_plan TEXT").run();
  }

  // Per-session turn lookups (history loads, and last-played ordering on the session list).
  db.prepare("CREATE INDEX IF NOT EXISTS idx_turn_history_session_created ON turn_history(sessionId, createdAt)").run();

  // Authoritative riddle state, independent of suggested choices. Answers are
  // server-only: never part of public session, history, or event payloads.
  // status: active | solved | expired | abandoned. One row per posing turn.
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_riddles (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      source_turn_id INTEGER NOT NULL,
      source_turn_number INTEGER NOT NULL,
      prompt TEXT,
      canonical_answer TEXT,
      aliases TEXT NOT NULL DEFAULT '[]',
      wrong_answers TEXT NOT NULL DEFAULT '[]',
      answer_known INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_riddles_source ON session_riddles(session_id, source_turn_id);
    CREATE INDEX IF NOT EXISTS idx_session_riddles_status ON session_riddles(session_id, status);
  `);
  // Where the answer came from: the narration that posed the riddle (authoritative), or
  // the choices agent's flagged answer (turns from before narration produced riddles).
  const riddleCols = (db.prepare("PRAGMA table_info(session_riddles)").all() as { name: string }[]).map(r => r.name);
  if (!riddleCols.includes('source')) {
    db.prepare("ALTER TABLE session_riddles ADD COLUMN source TEXT NOT NULL DEFAULT 'choices'").run();
  }

  // Ideas: a turn's suggested choices are current only for the revision and acting hero
  // they were made for. NULL (turns from before this) means "current while latest".
  const turnColsIdeas = (db.prepare("PRAGMA table_info(turn_history)").all() as { name: string }[]).map(r => r.name);
  if (!turnColsIdeas.includes('ideas_revision')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN ideas_revision INTEGER").run();
  }
  if (!turnColsIdeas.includes('ideas_character_id')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN ideas_character_id TEXT").run();
  }
  if (!turnColsIdeas.includes('ideas_degraded')) {
    db.prepare("ALTER TABLE turn_history ADD COLUMN ideas_degraded INTEGER NOT NULL DEFAULT 0").run();
  }
  // Onboarding sessions ask for ideas once by themselves: 'pending' until the first
  // viewer's request, then 'requested'. NULL for every other session.
  const sessionColsIdeas = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map(r => r.name);
  if (!sessionColsIdeas.includes('onboarding_ideas')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN onboarding_ideas TEXT").run();
  }
  // Realm setting "Suggest ideas each turn": views ask for ideas once per new turn.
  if (!sessionColsIdeas.includes('auto_ideas')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN auto_ideas INTEGER NOT NULL DEFAULT 0").run();
  }
  // Per-namespace app settings (e.g. images on/off for new realms). Replaces the old
  // server-wide app_settings table, which lived in a separate working-directory database.
  db.exec(`
    CREATE TABLE IF NOT EXISTS namespace_settings (
      namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (namespace_id, key)
    );
  `);
};
