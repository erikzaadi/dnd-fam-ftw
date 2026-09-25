import Database, { type Database as DB } from 'libsql';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/env.js';
import { migrate } from './migrations.js';

let db: DB | null = null;

export const initializeDatabase = (): void => {
  getDb();
};

export const getDb = (): DB => {
  if (!db) {
    const config = getConfig();
    const dbPath = path.resolve(config.SQLITE_DB_PATH);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    migrate(db);
  }
  return db;
};

// Runs fn in a transaction, or inside the caller's open one. libsql's transaction()
// always issues BEGIN and cannot nest, so building blocks that may run inside a larger
// transaction (e.g. account creation during sign-in) use this.
export const runInTransaction = <T>(fn: () => T): T => {
  const database = getDb();
  return database.inTransaction ? fn() : database.transaction(fn)();
};
