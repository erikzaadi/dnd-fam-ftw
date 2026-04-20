/**
 * Unified management CLI for dnd-fam-ftw.
 *
 * Usage:
 *   npm run cli -- <resource> [sub-command] [args...] [--json]
 *
 * Resources:
 *   users           list | add <email> [name] | remove <email>
 *   namespaces      list | create <name> | rename <id> <name> | delete <id>
 *                   sessions <id> | assign-session <sessionId> <nsId>
 *                   add-user <nsId> <email> | set-limits <id> [--max-sessions N] [--max-turns N]
 *   sessions        list [--json] | nuke | seed
 *   metrics         [--json]
 *   invite-requests list [--json] | clear
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env'), quiet: true });

import Database from 'libsql';
import { StateService } from '../services/stateService.js';
import { getConfig } from '../config/env.js';

const [, , resource, subcommand, ...rest] = process.argv;
const allArgs = [subcommand, ...rest].filter(Boolean);
const jsonMode = process.argv.includes('--json') || process.argv.includes('-j');
const positional = allArgs.filter(a => a !== '--json' && a !== '-j' && !a.startsWith('--'));

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
  default:
    console.log(`
users <sub-command>
  list                    List all users with primary and all accessible namespaces
  add <email> [name]      Create a new user (and their namespace)
  remove <email>          Delete a user (and their namespace if empty)

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
  default:
    console.log(`
sessions <sub-command>
  list [--json]   List all sessions, characters, inventory, and turn history
  nuke            Delete all sessions and their data (dev only)
  seed            Seed example sessions (dev only, idempotent)
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
        WHERE ts.namespace_id = n.id AND th.imageSuggested = 1
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
  db.close();
  if (jsonMode) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  } else {
    console.log('\nOpenAI usage metrics by namespace\n');
    const col = (s: string | number, w: number) => String(s).padEnd(w);
    console.log(
      col('Namespace', 20) + col('Sessions', 10) + col('Turns', 8) +
      col('Images', 8) + col('Avatars', 9) + col('LocalAI', 9) +
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
        col(r.images_generated, 8) + col(r.avatars_generated, 9) + col(r.local_ai_sessions, 9) +
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
  users           list | add <email> [name] | remove <email>
  namespaces      list | create <name> | rename <id> <name> | delete <id>
                  sessions <id> | assign-session <sessionId> <nsId>
                  add-user <nsId> <email> | remove-user <nsId> <email> | set-limits <id> [--max-sessions N] [--max-turns N]
  sessions        list [--json] | nuke | seed
  metrics         [--json]
  invite-requests list [--json] | clear

Run cli <resource> for sub-command help.

Examples:
  npm run cli -- users list
  npm run cli -- namespaces list
  npm run cli -- namespaces add-user <nsId> someone@gmail.com
  npm -s run cli -- sessions list --json | jq '.sessions[].displayName'
  npm -s run cli -- metrics --json | jq '.[].total_turns'
`);

}

