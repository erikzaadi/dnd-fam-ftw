#!/usr/bin/env node
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "../database.sqlite");

try {
  const db = new Database(dbPath, { readonly: true });
  
  const sessions = db.prepare("SELECT * FROM sessions").all();
  const characters = db.prepare("SELECT * FROM characters").all();
  const inventory = db.prepare("SELECT * FROM inventory").all();
  const history = db.prepare("SELECT * FROM turn_history").all();

  console.log("=== SESSIONS ===");
  console.table(sessions);

  console.log("\n=== CHARACTERS ===");
  console.table(characters);

  console.log("\n=== INVENTORY ===");
  console.table(inventory);

  console.log("\n=== TURN HISTORY ===");
  console.table(history);
} catch (err) {
  console.error("Error accessing database:", err);
  process.exit(1);
}
