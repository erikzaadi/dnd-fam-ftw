import { getDb } from './database.js';

// Runs fn inside a single SQLite transaction. fn must be synchronous: an async
// function would return before its writes finish and the transaction would commit
// regardless of later failures. Nested calls join the outer transaction.
export const withTransaction = <T>(fn: () => T): T => {
  const db = getDb();
  if (db.inTransaction) {
    return fn();
  }
  return db.transaction(fn).immediate();
};
