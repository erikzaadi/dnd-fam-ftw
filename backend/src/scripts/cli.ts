/**
 * Unified management CLI for dnd-fam-ftw.
 *
 * Usage:
 *   npm run cli -- <resource> [sub-command] [args...] [--json]
 *
 * Resources:
 *   users           list | add <email> [name] | remove <email> | set-primary <e> <ns>
 *   namespaces      list | create <name> | rename <id> <name> | delete <id>
 *                   sessions <id> | assign-session <sessionId> <nsId>
 *                   add-user <nsId> <email> | set-limits <id> [--max-sessions N] [--max-turns N]
 *   sessions        list [--json] | nuke | seed | export | import
 *   metrics         [--json]
 *   invite-requests list [--json] | clear
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env'), quiet: true });

import Database from 'libsql';
import { StateService } from '../services/stateService.js';
import { getConfig } from '../config/env.js';

const [, , resource, subcommand, ...rest] = process.argv;
const allArgs = [subcommand, ...rest].filter(Boolean);
const jsonMode = process.argv.includes('--json') || process.argv.includes('-j');
const positional = allArgs.filter(a => a !== '--json' && a !== '-j' && !a.startsWith('--')).slice(1);

function parseArgValue(arg: string | undefined): string | undefined {
  if (!arg) {
    return undefined;
  }
  if (arg.includes('=')) {
    return arg.split('=').slice(1).join('=');
  }
  const idx = allArgs.indexOf(arg);
  return idx >= 0 ? allArgs[idx + 1] : undefined;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

StateService.initialize();

switch (resource) {

// ── users ─────────────────────────────────────────────────────────────────────

case 'users': {
  switch (subcommand) {
  case 'list': {
    const users = StateService.listUsers();
    if (jsonMode) {
      process.stdout.write(JSON.stringify(users, null, 2) + '\n');
    } else if (users.length === 0) {
      console.log('No users found.');
    } else {
      const col = (s: string | number, w: number) => String(s).padEnd(w);
      console.log(`\n${col('Email', 35)} ${col('Primary NS', 22)} ${col('All Namespaces', 35)} ${col('Role', 8)} Created`);
      console.log('-'.repeat(115));
      for (const u of users) {
        const allNs = u.namespaces.map(n => n.name).join(', ') || u.namespace_name;
        console.log(`${col(u.email, 35)} ${col(u.namespace_name, 22)} ${col(allNs, 35)} ${col(u.role, 8)} ${u.created_at}`);
      }
      console.log();
    }
    break;
  }
  case 'add': {
    const [email, namespaceName] = positional;
    if (!email) {
      fail('Usage: cli users add <email> [namespace-name]');
    }
    const existing = StateService.getUserByEmail(email);
    if (existing) {
      console.error(`User already exists: ${email} (namespace: ${existing.namespace_id})`);
      process.exit(1);
    }
    const { userId, namespaceId } = StateService.createUser(email, namespaceName);
    console.log(`Created user: ${email}`);
    console.log(`  userId:      ${userId}`);
    console.log(`  namespaceId: ${namespaceId}`);
    break;
  }
  case 'remove': {
    const [email] = positional;
    if (!email) {
      fail('Usage: cli users remove <email>');
    }
    const deleted = StateService.deleteUser(email);
    if (deleted) {
      console.log(`Deleted user: ${email}`);
    } else {
      console.error(`User not found: ${email}`);
      process.exit(1);
    }
    break;
  }
  case 'set-primary': {
    const [email, namespaceId] = positional;
    if (!email || !namespaceId) {
      fail('Usage: cli users set-primary <email> <namespaceId>');
    }
    const result = StateService.setPrimaryNamespace(email, namespaceId);
    if (result.ok) {
      console.log(`Updated primary namespace for ${email} to ${namespaceId}`);
    } else {
      console.error(`Error: ${result.reason}`);
      process.exit(1);
    }
    break;
  }
  default:
    console.log(`
users <sub-command>
  list                    List all users with primary and all accessible namespaces
  add <email> [name]      Create a new user (and their namespace)
  remove <email>          Delete a user (and their namespace if empty)
  set-primary <e> <ns>    Change a user's primary namespace

Options:
  --json   Output as JSON (list only)
`);
  }
  break;
}

// ── namespaces ────────────────────────────────────────────────────────────────

case 'namespaces': {
  switch (subcommand) {
  case 'list': {
    const ns = StateService.listNamespaces();
    if (jsonMode) {
      process.stdout.write(JSON.stringify(ns, null, 2) + '\n');
    } else if (ns.length === 0) {
      console.log('No namespaces found.');
    } else {
      const col = (s: string | number, w: number) => String(s).padEnd(w);
      console.log(`\n${col('ID', 12)} ${col('Name', 24)} ${col('Users', 7)} ${col('Sessions', 10)} ${col('Limits', 22)} Created`);
      console.log('-'.repeat(95));
      for (const n of ns) {
        const limits = [
          n.max_sessions != null ? `sess<=${n.max_sessions}` : null,
          n.max_turns != null ? `turns<=${n.max_turns}` : null,
        ].filter(Boolean).join(', ') || 'unlimited';
        console.log(`${col(n.id, 12)} ${col(n.name, 24)} ${col(n.user_count, 7)} ${col(n.session_count, 10)} ${col(limits, 22)} ${n.created_at}`);
      }
      console.log();
    }
    break;
  }
  case 'create': {
    const [name] = positional;
    if (!name) {
      fail('Usage: cli namespaces create <name>');
    }
    const { namespaceId } = StateService.createNamespace(name);
    console.log(`Created namespace: "${name}"\n  namespaceId: ${namespaceId}`);
    break;
  }
  case 'rename': {
    const [id, newName] = positional;
    if (!id || !newName) {
      fail('Usage: cli namespaces rename <id> <new-name>');
    }
    const ok = StateService.renameNamespace(id, newName);
    if (ok) {
      console.log(`Renamed namespace ${id} to "${newName}"`);
    } else {
      console.error(`Namespace not found: ${id}`);
      process.exit(1);
    }
    break;
  }
  case 'delete': {
    const [id] = positional;
    if (!id) {
      fail('Usage: cli namespaces delete <id>');
    }
    const result = StateService.deleteNamespace(id);
    if (result.ok) {
      console.log(`Deleted namespace: ${id}`);
    } else {
      console.error(`Cannot delete: ${result.reason}`);
      process.exit(1);
    }
    break;
  }
  case 'sessions': {
    const [id] = positional;
    if (!id) {
      fail('Usage: cli namespaces sessions <namespace-id>');
    }
    const ns = StateService.getNamespaceById(id);
    if (!ns) {
      console.error(`Namespace not found: ${id}`);
      process.exit(1);
    }
    const sessions = StateService.listSessionsInNamespace(id);
    if (jsonMode) {
      process.stdout.write(JSON.stringify(sessions, null, 2) + '\n');
    } else if (sessions.length === 0) {
      console.log(`No sessions in namespace "${ns.name}" (${id})`);
    } else {
      const col = (s: string | number, w: number) => String(s).padEnd(w);
      console.log(`\nSessions in "${ns.name}" (${id}):`);
      console.log(`${col('ID', 12)} ${col('Name', 28)} ${col('Turn', 6)} Created`);
      console.log('-'.repeat(65));
      for (const s of sessions) {
        console.log(`${col(s.id, 12)} ${col(s.displayName, 28)} ${col(s.turn, 6)} ${s.createdAt}`);
      }
      console.log();
    }
    break;
  }
  case 'assign-session': {
    const [sessionId, nsId] = positional;
    if (!sessionId || !nsId) {
      fail('Usage: cli namespaces assign-session <sessionId> <namespaceId>');
    }
    const ns = StateService.getNamespaceById(nsId);
    if (!ns) {
      console.error(`Namespace not found: ${nsId}`);
      process.exit(1);
    }
    const ok = StateService.assignSessionToNamespace(sessionId, nsId);
    if (ok) {
      console.log(`Assigned session ${sessionId} to namespace "${ns.name}" (${nsId})`);
    } else {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }
    break;
  }
  case 'add-user': {
    const [nsId, email] = positional;
    if (!nsId || !email) {
      fail('Usage: cli namespaces add-user <namespaceId> <email>');
    }
    const result = StateService.addUserToNamespace(email, nsId);
    if (result.ok) {
      console.log(`Granted ${email} access to namespace ${nsId}`);
    } else {
      console.error(`Error: ${result.reason}`);
      process.exit(1);
    }
    break;
  }
  case 'remove-user': {
    const [nsId, email] = positional;
    if (!nsId || !email) {
      fail('Usage: cli namespaces remove-user <namespaceId> <email>');
    }
    const result = StateService.removeUserFromNamespace(email, nsId);
    if (result.ok) {
      console.log(`Removed ${email} access to namespace ${nsId}`);
    } else {
      console.error(`Error: ${result.reason}`);
      process.exit(1);
    }
    break;
  }
  case 'set-limits': {
    const [id] = positional;
    if (!id) {
      fail('Usage: cli namespaces set-limits <id> [--max-sessions N] [--max-turns N]');
    }
    const ns = StateService.getNamespaceById(id);
    if (!ns) {
      console.error(`Namespace not found: ${id}`);
      process.exit(1);
    }
    const maxSessionsArg = allArgs.find(a => a.startsWith('--max-sessions'));
    const maxTurnsArg = allArgs.find(a => a.startsWith('--max-turns'));
    const parseLimit = (arg: string | undefined): number | null | undefined => {
      if (!arg) {
        return undefined;
      }
      const val = arg.includes('=') ? arg.split('=')[1] : allArgs[allArgs.indexOf(arg) + 1];
      if (val === 'null' || val === 'unlimited') {
        return null;
      }
      const n = parseInt(val, 10);
      return isNaN(n) ? undefined : n;
    };
    const maxSessions = parseLimit(maxSessionsArg);
    const maxTurns = parseLimit(maxTurnsArg);
    if (maxSessions === undefined && maxTurns === undefined) {
      const limits = StateService.getNamespaceLimits(id);
      console.log(`Namespace "${ns.name}" (${id}) limits:`);
      console.log(`  max-sessions: ${limits.maxSessions ?? 'unlimited'}`);
      console.log(`  max-turns:    ${limits.maxTurns ?? 'unlimited'}`);
      break;
    }
    const current = StateService.getNamespaceLimits(id);
    const newMaxSessions = maxSessions !== undefined ? maxSessions : current.maxSessions;
    const newMaxTurns = maxTurns !== undefined ? maxTurns : current.maxTurns;
    StateService.setNamespaceLimits(id, newMaxSessions, newMaxTurns);
    console.log(`Updated limits for "${ns.name}" (${id}):`);
    console.log(`  max-sessions: ${newMaxSessions ?? 'unlimited'}`);
    console.log(`  max-turns:    ${newMaxTurns ?? 'unlimited'}`);
    break;
  }
  default:
    console.log(`
namespaces <sub-command> [args]
  list                                List all namespaces with user and session counts
  create <name>                       Create a standalone namespace
  rename <id> <new-name>              Rename a namespace
  delete <id>                         Delete an empty namespace
  sessions <id>                       List sessions in a namespace
  assign-session <sessionId> <nsId>   Move a session to a namespace
  add-user <nsId> <email>             Grant user access to a namespace
  remove-user <nsId> <email>          Remove user access from a namespace
  set-limits <id> [--max-sessions N] [--max-turns N]  Set or view limits

Options:
  --json   Output as JSON (list and sessions only)

Examples:
  cli namespaces list
  cli namespaces create "Family Night"
  cli namespaces add-user abc123 someone@gmail.com
  cli namespaces remove-user abc123 someone@gmail.com
  cli namespaces set-limits abc123 --max-sessions 5 --max-turns 50
  cli namespaces set-limits abc123 --max-sessions null
`);
  }
  break;
}

// ── sessions ──────────────────────────────────────────────────────────────────

case 'sessions': {
  switch (subcommand) {
  case 'list': {
    const dbPath = path.resolve(getConfig().SQLITE_DB_PATH);
    const db = new Database(dbPath, { readonly: true });
    const sessions = db.prepare('SELECT * FROM sessions').all() as { id: string }[];
    const characters = db.prepare('SELECT * FROM characters').all() as { id: string; sessionId: string }[];
    const inventory = db.prepare('SELECT * FROM inventory').all() as { characterId: string }[];
    const history = db.prepare('SELECT * FROM turn_history').all() as { sessionId: string }[];
    db.close();
    if (jsonMode) {
      const nested = sessions.map(s => ({
        ...s,
        characters: characters
          .filter(c => c.sessionId === s.id)
          .map(c => ({ ...c, inventory: inventory.filter(i => i.characterId === c.id) })),
        history: history.filter(h => h.sessionId === s.id),
      }));
      process.stdout.write(JSON.stringify(nested, null, 2) + '\n');
    } else {
      console.log(`\n=== SESSIONS ===`);
      console.table(sessions);
      console.log('\n=== CHARACTERS ===');
      console.table(characters);
      console.log('\n=== INVENTORY ===');
      console.table(inventory);
      console.log('\n=== TURN HISTORY ===');
      console.table(history);
    }
    break;
  }
  case 'nuke': {
    const dbPath = path.resolve(getConfig().SQLITE_DB_PATH);
    const db = new Database(dbPath);
    const tables = ['turn_choices', 'turn_history', 'inventory', 'characters', 'history', 'sessions'];
    const nuke = db.transaction(() => {
      for (const table of tables) {
        const { changes } = db.prepare(`DELETE FROM ${table}`).run();
        console.log(`- ${table}: ${changes} rows deleted`);
      }
    });
    console.log(`Nuking all sessions in ${dbPath}...`);
    nuke();
    db.close();
    console.log('Done.');
    break;
  }
  case 'seed': {
    // seed is a large standalone script - invoke it directly
    // Shift arguments so the script sees its own "cli" as arg[1]
    process.argv = [process.argv[0], process.argv[1], ...rest];
    await import('./seedSessions.js');
    break;
  }
  case 'export': {
    const sessionFilter = parseArgValue(allArgs.find(a => a === '--session' || a.startsWith('--session=')));
    const nsFilter = parseArgValue(allArgs.find(a => a === '--namespace' || a.startsWith('--namespace=')));
    const outputFile = parseArgValue(allArgs.find(a => a === '--output' || a.startsWith('--output=')));

    const dbPath = path.resolve(getConfig().SQLITE_DB_PATH);
    const db = new Database(dbPath, { readonly: true });

    let sessionRows: Record<string, unknown>[];
    if (sessionFilter) {
      sessionRows = db.prepare('SELECT * FROM sessions WHERE id = ?').all(sessionFilter) as Record<string, unknown>[];
      if (sessionRows.length === 0) {
        db.close();
        fail(`Session not found: ${sessionFilter}`);
      }
    } else if (nsFilter) {
      sessionRows = db.prepare('SELECT * FROM sessions WHERE namespace_id = ?').all(nsFilter) as Record<string, unknown>[];
    } else {
      sessionRows = db.prepare('SELECT * FROM sessions').all() as Record<string, unknown>[];
    }

    const exported = sessionRows.map(s => {
      const sessionId = s.id as string;
      const characters = (db.prepare('SELECT * FROM characters WHERE sessionId = ?').all(sessionId) as Record<string, unknown>[]).map(c => {
        const charId = c.id as string;
        const inventory = db.prepare('SELECT * FROM inventory WHERE characterId = ?').all(charId);
        return { ...c, inventory };
      });
      const turnHistory = (db.prepare('SELECT * FROM turn_history WHERE sessionId = ?').all(sessionId) as Record<string, unknown>[]).map(t => {
        const turnId = t.id as number;
        const choices = db.prepare('SELECT * FROM turn_choices WHERE turnId = ?').all(turnId);
        return { ...t, choices };
      });
      return { ...s, characters, turnHistory };
    });

    db.close();

    const output = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), sessions: exported }, null, 2);

    if (outputFile) {
      fs.writeFileSync(outputFile, output, 'utf-8');
      console.error(`Exported ${exported.length} session(s) to ${outputFile}`);
    } else {
      process.stdout.write(output + '\n');
    }
    break;
  }
  case 'import': {
    const [inputFile] = positional;
    if (!inputFile) {
      fail('Usage: cli sessions import <file.json> [--namespace-id <id>]');
    }
    const targetNsId = parseArgValue(allArgs.find(a => a === '--namespace-id' || a.startsWith('--namespace-id=')));

    let data: { version?: number; sessions: Record<string, unknown>[] };
    try {
      data = JSON.parse(fs.readFileSync(inputFile, 'utf-8')) as typeof data;
    } catch (err) {
      fail(`Failed to read ${inputFile}: ${err}`);
    }
    if (!data.sessions || !Array.isArray(data.sessions)) {
      fail('Invalid export file: missing sessions array');
    }

    const dbPath = path.resolve(getConfig().SQLITE_DB_PATH);
    const db = new Database(dbPath);

    if (targetNsId) {
      const ns = db.prepare('SELECT id FROM namespaces WHERE id = ?').get(targetNsId);
      if (!ns) {
        db.close();
        fail(`Namespace not found: ${targetNsId}`);
      }
    }

    let importedCount = 0;

    const importAll = db.transaction(() => {
      for (const session of data.sessions) {
        const oldSessionId = session.id as string;
        const exists = db.prepare('SELECT id FROM sessions WHERE id = ?').get(oldSessionId);
        const newSessionId = exists ? Math.random().toString(36).substring(7) : oldSessionId;
        const nsId = targetNsId ?? (session.namespace_id as string) ?? 'local';

        db.prepare(`
          INSERT INTO sessions (id, scene, sceneId, worldDescription, dm_prep, turn, activeCharacterId, tone, displayName, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, storySummary, namespace_id, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newSessionId,
          session.scene, session.sceneId, session.worldDescription ?? null, session.dm_prep ?? null,
          session.turn, session.activeCharacterId, session.tone, session.displayName,
          session.difficulty, session.gameMode ?? 'balanced',
          session.savingsMode ?? 0, session.useLocalAI ?? 0, session.interventionUsed ?? 0,
          session.storySummary ?? '', nsId,
          session.createdAt ?? null,
        );

        const charIdMap = new Map<string, string>();
        for (const char of (session.characters as Record<string, unknown>[]) ?? []) {
          const oldCharId = char.id as string;
          const charExists = db.prepare('SELECT id FROM characters WHERE id = ?').get(oldCharId);
          const newCharId = charExists ? Math.random().toString(36).substring(7) : oldCharId;
          charIdMap.set(oldCharId, newCharId);

          db.prepare(`
            INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, avatarUrl, avatarPrompt, status, avatar_storage_key, avatar_storage_provider, history, gender)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            newCharId, newSessionId,
            char.name, char.class, char.species, char.quirk,
            char.hp, char.max_hp, char.might, char.magic, char.mischief,
            char.avatarUrl ?? null, char.avatarPrompt ?? null,
            char.status ?? 'active',
            char.avatar_storage_key ?? null, char.avatar_storage_provider ?? null,
            char.history ?? null, char.gender ?? null,
          );

          for (const item of (char.inventory as Record<string, unknown>[]) ?? []) {
            db.prepare(`
              INSERT INTO inventory (characterId, itemId, name, description, statBonuses, healValue, transferable, consumable)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              newCharId, item.itemId ?? null, item.name, item.description ?? '',
              item.statBonuses ?? null, item.healValue ?? null,
              item.transferable ?? null, item.consumable ?? null,
            );
          }
        }

        for (const turn of (session.turnHistory as Record<string, unknown>[]) ?? []) {
          const mappedCharId = turn.characterId ? (charIdMap.get(turn.characterId as string) ?? null) : null;
          const result = db.prepare(`
            INSERT INTO turn_history (sessionId, characterId, narration, rollNarration, imagePrompt, imageSuggested, imageUrl, image_storage_key, image_storage_provider, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus, actionItemBonus, actionIsCritical, actionImpact, actionDifficultyTarget, turnType, currentTensionLevel, hpChanges, inventoryChanges)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            newSessionId, mappedCharId,
            turn.narration, turn.rollNarration ?? null,
            turn.imagePrompt ?? null, turn.imageSuggested ?? 0,
            turn.imageUrl ?? null, turn.image_storage_key ?? null, turn.image_storage_provider ?? null,
            turn.actionAttempt ?? null, turn.actionStat ?? null,
            turn.actionSuccess ?? null, turn.actionRoll ?? null,
            turn.actionStatBonus ?? null, turn.actionItemBonus ?? null,
            turn.actionIsCritical ?? null, turn.actionImpact ?? null, turn.actionDifficultyTarget ?? null,
            turn.turnType ?? 'normal',
            turn.currentTensionLevel ?? null, turn.hpChanges ?? null, turn.inventoryChanges ?? null,
          );

          const newTurnId = result.lastInsertRowid;
          for (const choice of (turn.choices as Record<string, unknown>[]) ?? []) {
            db.prepare('INSERT INTO turn_choices (turnId, label, difficulty, stat, difficultyValue, narration) VALUES (?, ?, ?, ?, ?, ?)')
              .run(newTurnId, choice.label, choice.difficulty, choice.stat, choice.difficultyValue ?? null, choice.narration ?? null);
          }
        }

        const idNote = exists ? ` (old ID: ${oldSessionId} -> new: ${newSessionId})` : ` (ID: ${newSessionId})`;
        console.log(`  Imported "${session.displayName}"${idNote} -> namespace: ${nsId}`);
        importedCount++;
      }
    });

    importAll();
    db.close();
    console.log(`\nImported ${importedCount} session(s).`);
    break;
  }
  default:
    console.log(`
sessions <sub-command>
  list [--json]                                         List all sessions, characters, inventory, and turn history
  nuke                                                  Delete all sessions and their data (dev only)
  seed                                                  Seed example sessions (dev only, idempotent)
  export [--session <id>] [--namespace <id>] [--output <file>]   Export sessions to JSON (stdout if no --output)
  import <file.json> [--namespace-id <id>]              Import sessions from a JSON export file
`);
  }
  break;
}

// ── metrics ───────────────────────────────────────────────────────────────────

case 'metrics': {
  interface NamespaceMetrics {
    namespace_id: string;
    namespace_name: string;
    session_count: number;
    total_turns: number;
    images_generated: number;
    avatars_generated: number;
    tts_requests: number;
    tts_characters: number;
    local_ai_sessions: number;
    savings_mode_sessions: number;
    max_sessions: number | null;
    max_turns: number | null;
  }
  const dbPath = path.resolve(getConfig().SQLITE_DB_PATH);
  const db = new Database(dbPath, { readonly: true });
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
      COALESCE((
        SELECT COUNT(*) FROM tts_usage tu
        WHERE tu.namespace_id = n.id AND tu.provider = 'openai'
      ), 0) AS tts_requests,
      COALESCE((
        SELECT SUM(tu.character_count) FROM tts_usage tu
        WHERE tu.namespace_id = n.id AND tu.provider = 'openai'
      ), 0) AS tts_characters,
      COUNT(DISTINCT CASE WHEN s.useLocalAI = 1 THEN s.id END) AS local_ai_sessions,
      COUNT(DISTINCT CASE WHEN s.savingsMode = 1 THEN s.id END) AS savings_mode_sessions
    FROM namespaces n
    LEFT JOIN sessions s ON s.namespace_id = n.id
    GROUP BY n.id
    ORDER BY n.created_at
  `).all() as NamespaceMetrics[];
  db.close();
  if (jsonMode) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  } else {
    console.log('\nOpenAI usage metrics by namespace\n');
    const col = (s: string | number, w: number) => String(s).padEnd(w);
    console.log(
      col('Namespace', 20) + col('Sessions', 10) + col('Turns', 8) +
      col('Images', 8) + col('Avatars', 9) + col('TTS', 7) + col('TTS Chars', 11) + col('LocalAI', 9) +
      col('SavingsMode', 13) + 'Limits'
    );
    console.log('-'.repeat(90));
    for (const r of rows) {
      const limits = [
        r.max_sessions != null ? `sessions<=${r.max_sessions}` : null,
        r.max_turns != null ? `turns<=${r.max_turns}` : null,
      ].filter(Boolean).join(', ') || 'unlimited';
      console.log(
        col(r.namespace_name, 20) + col(r.session_count, 10) + col(r.total_turns, 8) +
        col(r.images_generated, 8) + col(r.avatars_generated, 9) + col(r.tts_requests, 7) + col(r.tts_characters, 11) + col(r.local_ai_sessions, 9) +
        col(r.savings_mode_sessions, 13) + limits
      );
    }
    console.log();
  }
  break;
}

// ── invite-requests ───────────────────────────────────────────────────────────

case 'invite-requests': {
  switch (subcommand) {
  case 'list': {
    const requests = StateService.listInviteRequests();
    if (jsonMode) {
      process.stdout.write(JSON.stringify(requests, null, 2) + '\n');
    } else if (requests.length === 0) {
      console.log('No pending invite requests.');
    } else {
      console.log(`\nPending invite requests (${requests.length}):\n`);
      for (const r of requests) {
        console.log(`  ${r.email} - ${r.created_at}`);
        if (r.message) {
          console.log(`    Message: ${r.message}`);
        }
      }
      console.log();
    }
    break;
  }
  case 'clear': {
    const count = StateService.clearInviteRequests();
    console.log(`Cleared ${count} invite request(s).`);
    break;
  }
  default:
    console.log(`
invite-requests <sub-command>
  list [--json]   Show all pending invite requests
  clear           Delete all invite requests
`);
  }
  break;
}

// ── default ───────────────────────────────────────────────────────────────────

default:
  console.log(`
dnd-fam-ftw management CLI

Usage: npm run cli -- <resource> [sub-command] [args...] [--json]

Resources:
  users           list | add <email> [name] | remove <email> | set-primary <e> <ns>
  namespaces      list | create <name> | rename <id> <name> | delete <id>
                  sessions <id> | assign-session <sessionId> <nsId>
                  add-user <nsId> <email> | remove-user <nsId> <email> | set-limits <id> [--max-sessions N] [--max-turns N]
  sessions        list [--json] | nuke | seed | export | import
  metrics         [--json]
  invite-requests list [--json] | clear

Run cli <resource> for sub-command help.

Examples:
  npm run cli -- users list
  npm run cli -- namespaces list
  npm run cli -- namespaces add-user <nsId> someone@gmail.com
  npm -s run cli -- sessions list --json | jq '.sessions[].displayName'
  npm -s run cli -- metrics --json | jq '.[].total_turns'
  npm run cli -- sessions export --output backup.json
  npm run cli -- sessions export --session abc123 --output session.json
  npm run cli -- sessions import backup.json --namespace-id xyz789
`);

}
