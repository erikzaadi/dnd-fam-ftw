/**
 * OpenAI usage metrics per namespace.
 *
 * Usage (from repo root):
 *   npm run usage-metrics
 *   npm run usage-metrics -- --json
 *
 * Or on production via dnd-fam-ftw-prod-cli:
 *   ./dnd-fam-ftw-prod-cli usage-metrics
 *   ./dnd-fam-ftw-prod-cli usage-metrics --json
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env'), quiet: true });

import Database from 'libsql';
import { getConfig } from '../config/env.js';

const jsonMode = process.argv.includes('--json');

const config = getConfig();
const db = new Database(path.resolve(config.SQLITE_DB_PATH), { readonly: true });

interface NamespaceMetrics {
  namespace_id: string;
  namespace_name: string;
  session_count: number;
  total_turns: number;
  images_generated: number;
  avatars_generated: number;
  local_ai_sessions: number;
  savings_mode_sessions: number;
  max_sessions: number | null;
  max_turns: number | null;
}

const rows = db.prepare(`
  SELECT
    n.id AS namespace_id,
    n.name AS namespace_name,
    n.max_sessions,
    n.max_turns,
    COUNT(DISTINCT s.id) AS session_count,
    COALESCE(SUM(s.turn - 1), 0) AS total_turns,
    COALESCE((
      SELECT COUNT(*) FROM turn_history th
      JOIN sessions ts ON ts.id = th.sessionId
      WHERE ts.namespace_id = n.id AND th.image_storage_key IS NOT NULL
    ), 0) AS images_generated,
    COALESCE((
      SELECT COUNT(*) FROM characters c
      JOIN sessions ts ON ts.id = c.sessionId
      WHERE ts.namespace_id = n.id AND c.avatar_storage_key IS NOT NULL
    ), 0) AS avatars_generated,
    COUNT(DISTINCT CASE WHEN s.useLocalAI = 1 THEN s.id END) AS local_ai_sessions,
    COUNT(DISTINCT CASE WHEN s.savingsMode = 1 THEN s.id END) AS savings_mode_sessions
  FROM namespaces n
  LEFT JOIN sessions s ON s.namespace_id = n.id
  GROUP BY n.id
  ORDER BY n.created_at
`).all() as NamespaceMetrics[];

if (jsonMode) {
  process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
} else {
  console.log(`\nOpenAI usage metrics by namespace\n`);
  const col = (s: string | number, w: number) => String(s).padEnd(w);
  console.log(
    col('Namespace', 20) +
    col('Sessions', 10) +
    col('Turns', 8) +
    col('Images', 8) +
    col('Avatars', 9) +
    col('LocalAI', 9) +
    col('SavingsMode', 13) +
    'Limits'
  );
  console.log('-'.repeat(90));
  for (const r of rows) {
    const limits = [
      r.max_sessions != null ? `sessions<=${r.max_sessions}` : null,
      r.max_turns != null ? `turns<=${r.max_turns}` : null,
    ].filter(Boolean).join(', ') || 'unlimited';
    console.log(
      col(r.namespace_name, 20) +
      col(r.session_count, 10) +
      col(r.total_turns, 8) +
      col(r.images_generated, 8) +
      col(r.avatars_generated, 9) +
      col(r.local_ai_sessions, 9) +
      col(r.savings_mode_sessions, 13) +
      limits
    );
  }
  console.log();
}

db.close();
