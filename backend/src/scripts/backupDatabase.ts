// Consistent SQLite backup and verification, used by the backup/restore workflows.
// Runs from a deployed release: node dist/scripts/backupDatabase.js <command> ...
//
//   backup <sourceDb> <outFile> [appVersion]   VACUUM INTO a consistent copy, verify it, print metadata JSON
//   verify <dbFile>                            integrity + schema + readable sessions/history; print metadata JSON
//
// Deliberately opens databases directly with libsql instead of the app's getDb(),
// which would run migrations against the file being inspected.
import fs from 'fs';
import path from 'path';
import Database from 'libsql';

type BackupMetadata = {
  file: string;
  createdAt: string;
  sizeBytes: number;
  integrity: string;
  appVersion: string | null;
  schema: {
    tables: string[];
    sessionColumns: number;
    turnHistoryColumns: number;
  };
  counts: {
    sessions: number;
    turnHistory: number;
  };
};

const REQUIRED_TABLES = ['sessions', 'characters', 'inventory', 'turn_history', 'turn_choices', 'namespaces', 'users'];

const fail = (message: string): never => {
  console.error(`[backup] ERROR: ${message}`);
  process.exit(1);
};

const inspect = (file: string, appVersion: string | null): BackupMetadata => {
  if (!fs.existsSync(file)) {
    fail(`database not found: ${file}`);
  }
  const db = new Database(file);
  try {
    const integrityRows = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
    const integrity = integrityRows.map(row => row.integrity_check).join('; ');
    if (integrity !== 'ok') {
      fail(`integrity_check failed for ${file}: ${integrity}`);
    }
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[])
      .map(row => row.name);
    const missing = REQUIRED_TABLES.filter(table => !tables.includes(table));
    if (missing.length > 0) {
      fail(`missing tables in ${file}: ${missing.join(', ')}`);
    }
    const columnCount = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as unknown[]).length;
    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    // Reading a real row proves the data is decodable, not just structurally valid.
    db.prepare('SELECT id, displayName FROM sessions ORDER BY rowid DESC LIMIT 1').get();
    db.prepare('SELECT id, narration FROM turn_history ORDER BY id DESC LIMIT 1').get();
    return {
      file: path.basename(file),
      createdAt: new Date().toISOString(),
      sizeBytes: fs.statSync(file).size,
      integrity,
      appVersion,
      schema: {
        tables,
        sessionColumns: columnCount('sessions'),
        turnHistoryColumns: columnCount('turn_history'),
      },
      counts: {
        sessions: count('sessions'),
        turnHistory: count('turn_history'),
      },
    };
  } finally {
    db.close();
  }
};

const backup = (source: string, out: string, appVersion: string | null): BackupMetadata => {
  if (!fs.existsSync(source)) {
    fail(`source database not found: ${source}`);
  }
  if (fs.existsSync(out)) {
    fs.unlinkSync(out);
  }
  const db = new Database(source);
  try {
    // VACUUM INTO writes a transactionally consistent copy while the app keeps
    // running, unlike copying the live file (which can capture a torn write).
    db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  return inspect(out, appVersion);
};

const [command, ...args] = process.argv.slice(2);
if (command === 'backup') {
  const [source, out, appVersion] = args;
  if (!source || !out) {
    fail('usage: backup <sourceDb> <outFile> [appVersion]');
  }
  console.log(JSON.stringify(backup(source, out, appVersion ?? null), null, 2));
} else if (command === 'verify') {
  const [file] = args;
  if (!file) {
    fail('usage: verify <dbFile>');
  }
  console.log(JSON.stringify(inspect(file, null), null, 2));
} else {
  fail('usage: backup <sourceDb> <outFile> [appVersion] | verify <dbFile>');
}
