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
 *                   tier <id> [free|supporter|unlimited]
 *   sessions        list [--json] | nuke | seed | export | import | regenerate-dm-prep <id>
 *   metrics         [--json] [--since <ISO date>] | usage [--json] [--since <ISO date>] [--namespace <id>]
 *                   | narration [--json|--format csv] [--failed-only] [--namespace <id>] [--session <id>] [--since <ISO date>]
 *   invite-requests list [--json] | approve <email> [--namespace <name>] | clear
 *   limit-requests  list [--status <s>] [--json] | approve <id> [--tier <tier>] | deny <id>
 *   email-outbox    list [--status <s>] [--json] | retry <id> | send-test <address>
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env'), quiet: true });

import Database from 'libsql';
import { StateService } from '../services/stateService.js';
import { StorySummaryService } from '../services/storySummaryService.js';
import { getConfig } from '../config/env.js';
import { emailOutboxRepository, type EmailOutboxStatus } from '../repositories/emailOutboxRepository.js';
import { limitRequestRepository, type LimitRequestStatus } from '../repositories/limitRequestRepository.js';
import { getEmailProvider } from '../providers/email/emailProviderFactory.js';
import { USAGE_TIERS, getEffectiveLimits, isUsageTier, tierLabel } from '../services/usageLimitService.js';

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

function csvCell(value: unknown): string {
  if (value == null) {
    return '';
  }
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(rows: Record<string, unknown>[], columns: string[]): void {
  process.stdout.write(columns.join(',') + '\n');
  for (const row of rows) {
    process.stdout.write(columns.map(column => csvCell(row[column])).join(',') + '\n');
  }
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
      console.log(`\n${col('Email', 35)} ${col('Primary NS', 22)} ${col('All Namespaces', 35)} ${col('Role', 8)} ${col('Created', 22)} Last Login`);
      console.log('-'.repeat(140));
      for (const u of users) {
        const allNs = u.namespaces.map(n => n.name).join(', ') || u.namespace_name;
        console.log(`${col(u.email, 35)} ${col(u.namespace_name, 22)} ${col(allNs, 35)} ${col(u.role, 8)} ${col(u.created_at, 22)} ${u.lastLogin ?? 'never'}`);
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
    let addResult: { userId: string; namespaceId: string };
    if (namespaceName) {
      const existingNs = StateService.getNamespaceByName(namespaceName);
      if (existingNs) {
        addResult = StateService.createUserInExistingNamespace(email, existingNs.id);
        console.log(`Created user: ${email} (added to existing namespace: ${existingNs.name})`);
      } else {
        addResult = StateService.createUser(email, namespaceName);
        console.log(`Created user: ${email} (created new namespace: ${namespaceName})`);
      }
    } else {
      addResult = StateService.createUser(email);
      console.log(`Created user: ${email}`);
    }
    console.log(`  userId:      ${addResult.userId}`);
    console.log(`  namespaceId: ${addResult.namespaceId}`);
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
      console.log(`\n${col('ID', 12)} ${col('Name', 24)} ${col('Tier', 10)} ${col('Users', 7)} ${col('Sessions', 10)} ${col('Limits', 22)} Created`);
      console.log('-'.repeat(106));
      for (const n of ns) {
        const limits = [
          n.max_sessions != null ? `sess<=${n.max_sessions}` : null,
          n.max_turns != null ? `turns<=${n.max_turns}` : null,
        ].filter(Boolean).join(', ') || 'tier default';
        console.log(`${col(n.id, 12)} ${col(n.name, 24)} ${col(n.tier, 10)} ${col(n.user_count, 7)} ${col(n.session_count, 10)} ${col(limits, 22)} ${n.created_at}`);
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
      console.log(`  max-sessions: ${limits.maxSessions ?? 'tier default'}`);
      console.log(`  max-turns:    ${limits.maxTurns ?? 'tier default'}`);
      break;
    }
    const current = StateService.getNamespaceLimits(id);
    const newMaxSessions = maxSessions !== undefined ? maxSessions : current.maxSessions;
    const newMaxTurns = maxTurns !== undefined ? maxTurns : current.maxTurns;
    StateService.setNamespaceLimits(id, newMaxSessions, newMaxTurns);
    console.log(`Updated limits for "${ns.name}" (${id}):`);
    console.log(`  max-sessions: ${newMaxSessions ?? 'tier default'}`);
    console.log(`  max-turns:    ${newMaxTurns ?? 'tier default'}`);
    break;
  }
  case 'tier': {
    const [id, tier] = positional;
    if (!id) {
      fail(`Usage: cli namespaces tier <id> [${USAGE_TIERS.join('|')}]`);
    }
    const ns = StateService.getNamespaceById(id);
    if (!ns) {
      fail(`Namespace not found: ${id}`);
    }
    if (!tier) {
      const effective = getEffectiveLimits(id);
      const format = (value: number | null) => value ?? 'unlimited';
      console.log(`Namespace "${ns.name}" (${id}): ${effective.tier} (${tierLabel(effective.tier)})`);
      console.log(`  text credits/day: ${format(effective.textCreditsPerDay)}`);
      console.log(`  pictures/day:     ${format(effective.picturesPerDay)}`);
      console.log(`  max-sessions:     ${format(effective.maxSessions)}`);
      console.log(`  max-turns:        ${format(effective.maxTurns)}`);
      break;
    }
    if (!isUsageTier(tier)) {
      fail(`Unknown tier "${tier}". Use one of: ${USAGE_TIERS.join(', ')}`);
    }
    StateService.setNamespaceTier(id, tier);
    console.log(`Namespace "${ns.name}" (${id}) is now ${tier} (${tierLabel(tier)}).`);
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
  set-limits <id> [--max-sessions N] [--max-turns N]  Set or view per-namespace overrides (null = tier default)
  tier <id> [free|supporter|unlimited]  View effective limits or change the usage tier

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
          INSERT INTO sessions (id, scene, sceneId, worldDescription, dm_prep, dm_prep_image_brief, turn, activeCharacterId, tone, displayName, difficulty, gameMode, savingsMode, useLocalAI, interventionUsed, storySummary, namespace_id, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newSessionId,
          session.scene, session.sceneId, session.worldDescription ?? null, session.dm_prep ?? null,
          session.dm_prep_image_brief ?? null,
          session.turn, session.activeCharacterId, session.tone, session.displayName,
          session.difficulty, session.gameMode ?? 'balanced',
          session.savingsMode ?? 0, 0, session.interventionUsed ?? 0,
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
              INSERT INTO inventory (characterId, itemId, name, description, statBonuses, healValue, transferable, consumable, tags, effect, charges, condition, boundToCharacterId)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              newCharId, item.itemId ?? null, item.name, item.description ?? '',
              item.statBonuses ?? null, item.healValue ?? null,
              item.transferable ?? null, item.consumable ?? null,
              item.tags ?? null, item.effect ?? null, item.charges ?? null,
              item.condition ?? null, item.boundToCharacterId ?? null,
            );
          }
        }

        for (const turn of (session.turnHistory as Record<string, unknown>[]) ?? []) {
          const mappedCharId = turn.characterId ? (charIdMap.get(turn.characterId as string) ?? null) : null;
          const result = db.prepare(`
INSERT INTO turn_history (sessionId, characterId, encounterId, narration, rollNarration, imagePrompt, imageSuggested, imageUrl, image_storage_key, image_storage_provider, actionAttempt, actionStat, actionSuccess, actionRoll, actionStatBonus, actionItemBonus, actionHelperBonus, actionHelperCharacterName, actionChoiceItemBonus, actionChoiceItemName, actionChoiceItemOwnerName, actionCharacterBonus, actionCharacterBonusLabel, actionIsCritical, actionImpact, actionDifficultyTarget, turnType, currentTensionLevel, hpChanges, inventoryChanges, narrationRetried, narrationFailed, narrationValidationError, narrationRetryValidationError, createdAt)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            newSessionId, mappedCharId, turn.encounterId ?? null,
            turn.narration, turn.rollNarration ?? null,
            turn.imagePrompt ?? null, turn.imageSuggested ?? 0,
            turn.imageUrl ?? null, turn.image_storage_key ?? null, turn.image_storage_provider ?? null,
            turn.actionAttempt ?? null, turn.actionStat ?? null,
            turn.actionSuccess ?? null, turn.actionRoll ?? null,
            turn.actionStatBonus ?? null, turn.actionItemBonus ?? null,
            turn.actionHelperBonus ?? null, turn.actionHelperCharacterName ?? null,
            turn.actionChoiceItemBonus ?? null, turn.actionChoiceItemName ?? null, turn.actionChoiceItemOwnerName ?? null,
            turn.actionCharacterBonus ?? null, turn.actionCharacterBonusLabel ?? null,
            turn.actionIsCritical ?? null, turn.actionImpact ?? null, turn.actionDifficultyTarget ?? null,
            turn.turnType ?? 'normal',
            turn.currentTensionLevel ?? null, turn.hpChanges ?? null, turn.inventoryChanges ?? null,
            turn.narrationRetried ?? null, turn.narrationFailed ?? null,
            turn.narrationValidationError ?? null, turn.narrationRetryValidationError ?? null,
            turn.createdAt ?? null,
          );

          const newTurnId = result.lastInsertRowid;
          for (const choice of (turn.choices as Record<string, unknown>[]) ?? []) {
            db.prepare('INSERT INTO turn_choices (turnId, label, difficulty, stat, difficultyValue, narration, flavor, helperCharacterName, itemOwnerName, itemName, environmentFeature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .run(
                newTurnId,
                choice.label,
                choice.difficulty,
                choice.stat,
                choice.difficultyValue ?? null,
                choice.narration ?? null,
                choice.flavor ?? null,
                choice.helperCharacterName ?? null,
                choice.itemOwnerName ?? null,
                choice.itemName ?? null,
                choice.environmentFeature ?? null,
              );
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
  case 'regenerate-dm-prep': {
    const [sessionId] = positional;
    if (!sessionId) {
      fail('Usage: cli sessions regenerate-dm-prep <sessionId>');
    }
    const session = await StateService.getSession(sessionId);
    if (!session) {
      fail(`Session not found: ${sessionId}`);
    }
    console.log(`Regenerating DM prep for "${session.displayName}" (${sessionId})...`);
    const brief = await StorySummaryService.generateCampaignBrief(
      sessionId,
      session.worldDescription,
      session.displayName,
      session.difficulty,
      session.gameMode,
    );
    if (brief) {
      console.log('\nDone. New DM prep:\n');
      console.log(brief);
    } else {
      console.error('Failed to generate DM prep.');
      process.exit(1);
    }
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
  regenerate-dm-prep <sessionId>                        Regenerate the DM campaign brief and encounter seeds using AI
`);
  }
  break;
}

// ── metrics ───────────────────────────────────────────────────────────────────

case 'metrics': {
  if (subcommand === 'usage') {
    interface UsageRow {
      day: string;
      namespace_id: string | null;
      namespace_name: string | null;
      text_calls: number;
      failed_calls: number;
      images: number;
      input_tokens: number;
      output_tokens: number;
      tts_characters: number;
      estimated_cost_usd: number;
    }
    const namespaceFilter = parseArgValue(allArgs.find(a => a === '--namespace' || a.startsWith('--namespace=')));
    const sinceArg = parseArgValue(allArgs.find(a => a === '--since' || a.startsWith('--since=')));
    const since = sinceArg ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const conditions = ['datetime(pu.created_at) >= datetime(?)'];
    const params: string[] = [since];
    if (namespaceFilter) {
      conditions.push('pu.namespace_id = ?');
      params.push(namespaceFilter);
    }
    const db = new Database(path.resolve(getConfig().SQLITE_DB_PATH), { readonly: true });
    let rows: UsageRow[];
    try {
      rows = db.prepare(`
        SELECT
          substr(pu.created_at, 1, 10) AS day,
          pu.namespace_id,
          n.name AS namespace_name,
          SUM(CASE WHEN pu.kind = 'text' THEN 1 ELSE 0 END) AS text_calls,
          SUM(CASE WHEN pu.success = 0 THEN 1 ELSE 0 END) AS failed_calls,
          SUM(CASE WHEN pu.kind = 'image' THEN COALESCE(pu.image_count, 1) ELSE 0 END) AS images,
          COALESCE(SUM(pu.input_tokens), 0) AS input_tokens,
          COALESCE(SUM(pu.output_tokens), 0) AS output_tokens,
          COALESCE(SUM(pu.tts_characters), 0) AS tts_characters,
          ROUND(COALESCE(SUM(pu.estimated_cost_usd), 0), 4) AS estimated_cost_usd
        FROM provider_usage pu
        LEFT JOIN namespaces n ON n.id = pu.namespace_id
        WHERE ${conditions.join(' AND ')}
        GROUP BY day, pu.namespace_id
        ORDER BY day DESC, estimated_cost_usd DESC
      `).all(...params) as UsageRow[];
    } catch (err) {
      db.close();
      fail(`Could not read provider usage (has the backend started since upgrading?): ${err instanceof Error ? err.message : String(err)}`);
    }
    db.close();
    if (jsonMode) {
      process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    } else if (rows.length === 0) {
      console.log(`No provider usage recorded since ${since}.`);
    } else {
      console.table(rows.map(row => ({
        day: row.day,
        namespace: row.namespace_name ?? row.namespace_id ?? '(system)',
        text: row.text_calls,
        images: row.images,
        failed: row.failed_calls,
        tts_chars: row.tts_characters,
        est_usd: row.estimated_cost_usd,
      })));
      const total = rows.reduce((sum, row) => sum + row.estimated_cost_usd, 0);
      console.log(`\nEstimated total since ${since}: $${total.toFixed(2)} (estimates; the provider dashboard is authoritative)`);
    }
    break;
  }

  if (subcommand === 'narration') {
    interface NarrationMetricsRow {
      turn_id: number;
      session_id: string;
      session_name: string;
      namespace_id: string;
      namespace_name: string;
      character_id: string | null;
      character_name: string | null;
      action_attempt: string | null;
      narration_retried: number | null;
      narration_failed: number | null;
      narration_validation_error: string | null;
      narration_retry_validation_error: string | null;
      narration: string;
      roll_narration: string | null;
      image_suggested: number;
      image_prompt: string | null;
    }

    const formatFlag = parseArgValue(allArgs.find(a => a === '--format' || a.startsWith('--format=')));
    const outputFormat = process.argv.includes('--csv') ? 'csv' : formatFlag ?? (jsonMode ? 'json' : 'table');
    if (!['table', 'json', 'csv'].includes(outputFormat)) {
      fail('Usage: cli metrics narration [--json|--format csv|--csv] [--failed-only] [--namespace <id>] [--session <id>] [--since <ISO date>]');
    }
    const namespaceFilter = parseArgValue(allArgs.find(a => a === '--namespace' || a.startsWith('--namespace=')));
    const sessionFilter = parseArgValue(allArgs.find(a => a === '--session' || a.startsWith('--session=')));
    const sinceFilter = parseArgValue(allArgs.find(a => a === '--since' || a.startsWith('--since=')));
    const failedOnly = process.argv.includes('--failed-only');

    const conditions = failedOnly
      ? ['COALESCE(th.narrationFailed, 0) = 1']
      : ['(COALESCE(th.narrationRetried, 0) = 1 OR COALESCE(th.narrationFailed, 0) = 1)'];
    const params: string[] = [];
    if (namespaceFilter) {
      conditions.push('s.namespace_id = ?');
      params.push(namespaceFilter);
    }
    if (sessionFilter) {
      conditions.push('th.sessionId = ?');
      params.push(sessionFilter);
    }
    if (sinceFilter) {
      conditions.push('datetime(th.createdAt) >= datetime(?)');
      params.push(sinceFilter);
    }

    const dbPath = path.resolve(getConfig().SQLITE_DB_PATH);
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare(`
      SELECT
        th.id AS turn_id,
        th.sessionId AS session_id,
        s.displayName AS session_name,
        s.namespace_id AS namespace_id,
        n.name AS namespace_name,
        th.characterId AS character_id,
        c.name AS character_name,
        th.actionAttempt AS action_attempt,
        th.narrationRetried AS narration_retried,
        th.narrationFailed AS narration_failed,
        th.narrationValidationError AS narration_validation_error,
        th.narrationRetryValidationError AS narration_retry_validation_error,
        th.narration,
        th.rollNarration AS roll_narration,
        th.imageSuggested AS image_suggested,
        th.imagePrompt AS image_prompt
      FROM turn_history th
      JOIN sessions s ON s.id = th.sessionId
      LEFT JOIN namespaces n ON n.id = s.namespace_id
      LEFT JOIN characters c ON c.id = th.characterId
      WHERE ${conditions.join(' AND ')}
      ORDER BY th.id DESC
    `).all(...params) as NarrationMetricsRow[];
    db.close();

    const normalized = rows.map(row => ({
      ...row,
      narration_retried: Boolean(row.narration_retried),
      narration_failed: Boolean(row.narration_failed),
      image_suggested: Boolean(row.image_suggested),
    }));

    if (outputFormat === 'json') {
      process.stdout.write(JSON.stringify(normalized, null, 2) + '\n');
    } else if (outputFormat === 'csv') {
      writeCsv(normalized, [
        'turn_id',
        'session_id',
        'session_name',
        'namespace_id',
        'namespace_name',
        'character_id',
        'character_name',
        'action_attempt',
        'narration_retried',
        'narration_failed',
        'narration_validation_error',
        'narration_retry_validation_error',
        'narration',
        'roll_narration',
        'image_suggested',
        'image_prompt',
      ]);
    } else if (normalized.length === 0) {
      console.log('No narration retries or failures found.');
    } else {
      console.table(normalized.map(row => ({
        turn_id: row.turn_id,
        session: row.session_name,
        character: row.character_name,
        retried: row.narration_retried,
        failed: row.narration_failed,
        error: row.narration_retry_validation_error ?? row.narration_validation_error,
      })));
      console.log('\nUse --json or --format csv for analysis-friendly output.');
    }
    break;
  }

  interface NamespaceMetrics {
    namespace_id: string;
    namespace_name: string;
    session_count: number;
    total_turns: number;
    images_generated: number;
    avatars_generated: number;
    tts_requests: number;
    tts_characters: number;
    savings_mode_sessions: number;
    max_sessions: number | null;
    max_turns: number | null;
    encounters_seeded: number;
    encounters_dynamic: number;
    new_sessions_since?: number;
    turns_since?: number;
    active_users_since?: number;
  }
  const sinceFilter = parseArgValue(allArgs.find(a => a === '--since' || a.startsWith('--since=')));
  const dbPath = path.resolve(getConfig().SQLITE_DB_PATH);
  const db = new Database(dbPath, { readonly: true });
  const sinceColumns = sinceFilter
    ? `,
      COALESCE((
        SELECT COUNT(DISTINCT s2.id) FROM sessions s2
        WHERE s2.namespace_id = n.id AND datetime(s2.createdAt) >= datetime(?)
      ), 0) AS new_sessions_since,
      COALESCE((
        SELECT COUNT(*) FROM turn_history th2
        JOIN sessions ts2 ON ts2.id = th2.sessionId
        WHERE ts2.namespace_id = n.id AND datetime(th2.createdAt) >= datetime(?)
      ), 0) AS turns_since,
      COALESCE((
        SELECT COUNT(DISTINCT u.id) FROM users u
        WHERE u.namespace_id = n.id AND datetime(u.lastLogin) >= datetime(?)
      ), 0) AS active_users_since`
    : '';
  const sinceParams = sinceFilter ? [sinceFilter, sinceFilter, sinceFilter] : [];
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
      COUNT(DISTINCT CASE WHEN s.savingsMode = 1 THEN s.id END) AS savings_mode_sessions${sinceColumns}
    FROM namespaces n
    LEFT JOIN sessions s ON s.namespace_id = n.id
    GROUP BY n.id
    ORDER BY n.created_at
  `).all(...sinceParams) as Omit<NamespaceMetrics, 'encounters_seeded' | 'encounters_dynamic'>[];

  // Count seeded vs. dynamic encounters by parsing JSON per session in Node.js
  const encounterRows = db.prepare(`
    SELECT s.namespace_id, s.past_encounters, s.dm_prep_encounters
    FROM sessions s
    WHERE s.past_encounters IS NOT NULL AND s.past_encounters != '[]'
  `).all() as { namespace_id: string; past_encounters: string; dm_prep_encounters: string | null }[];
  db.close();

  const encounterCountsByNamespace = new Map<string, { seeded: number; dynamic: number }>();
  for (const s of encounterRows) {
    const past = JSON.parse(s.past_encounters) as Array<{ name: string }>;
    const seeds: Array<{ name: string }> = s.dm_prep_encounters ? JSON.parse(s.dm_prep_encounters) : [];
    const seedNames = new Set(seeds.map(sd => sd.name.trim().toLowerCase()));
    const counts = encounterCountsByNamespace.get(s.namespace_id) ?? { seeded: 0, dynamic: 0 };
    for (const enc of past) {
      if (seedNames.has(enc.name.trim().toLowerCase())) {
        counts.seeded++;
      } else {
        counts.dynamic++;
      }
    }
    encounterCountsByNamespace.set(s.namespace_id, counts);
  }

  const metricsRows: NamespaceMetrics[] = rows.map(r => {
    const enc = encounterCountsByNamespace.get(r.namespace_id) ?? { seeded: 0, dynamic: 0 };
    return { ...r, encounters_seeded: enc.seeded, encounters_dynamic: enc.dynamic };
  });

  if (jsonMode) {
    process.stdout.write(JSON.stringify(metricsRows, null, 2) + '\n');
  } else {
    console.log('\nOpenAI usage metrics by namespace\n');
    const col = (s: string | number, w: number) => String(s).padEnd(w);
    console.log(
      col('Namespace', 20) + col('Sessions', 10) + col('Turns', 8) +
      col('Images', 8) + col('Avatars', 9) + col('TTS', 7) + col('TTS Chars', 11) +
      col('SavingsMode', 13) + col('Enc(prep)', 11) + col('Enc(dyn)', 10) + 'Limits'
    );
    console.log('-'.repeat(112));
    for (const r of metricsRows) {
      const limits = [
        r.max_sessions != null ? `sessions<=${r.max_sessions}` : null,
        r.max_turns != null ? `turns<=${r.max_turns}` : null,
      ].filter(Boolean).join(', ') || 'unlimited';
      console.log(
        col(r.namespace_name, 20) + col(r.session_count, 10) + col(r.total_turns, 8) +
        col(r.images_generated, 8) + col(r.avatars_generated, 9) + col(r.tts_requests, 7) + col(r.tts_characters, 11) +
        col(r.savings_mode_sessions, 13) + col(r.encounters_seeded, 11) + col(r.encounters_dynamic, 10) + limits
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
  case 'approve': {
    const [approveEmail] = positional;
    const approveNsName = parseArgValue(allArgs.find(a => a === '--namespace' || a.startsWith('--namespace=')));
    if (!approveEmail) {
      fail('Usage: cli invite-requests approve <email> [--namespace <name>]');
    }
    if (!StateService.hasInviteRequest(approveEmail)) {
      console.error(`No invite request found for: ${approveEmail}`);
      process.exit(1);
    }
    const existingApproveUser = StateService.getUserByEmail(approveEmail);
    if (existingApproveUser) {
      console.error(`User already exists: ${approveEmail}`);
      process.exit(1);
    }
    let approveResult: { userId: string; namespaceId: string };
    if (approveNsName) {
      const approveNs = StateService.getNamespaceByName(approveNsName);
      if (!approveNs) {
        console.error(`Namespace not found: ${approveNsName}`);
        process.exit(1);
      }
      approveResult = StateService.createUserInExistingNamespace(approveEmail, approveNs.id);
      console.log(`Approved invite for: ${approveEmail} (namespace: ${approveNs.name})`);
    } else {
      approveResult = StateService.createUser(approveEmail);
      console.log(`Approved invite for: ${approveEmail}`);
    }
    StateService.removeInviteRequest(approveEmail);
    console.log(`  userId:      ${approveResult.userId}`);
    console.log(`  namespaceId: ${approveResult.namespaceId}`);
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
  list [--json]                         Show all pending invite requests
  approve <email> [--namespace <name>]  Create user from invite request (removes request)
  clear                                 Delete all invite requests
`);
  }
  break;
}

// ── limit-requests ────────────────────────────────────────────────────────────

case 'limit-requests': {
  switch (subcommand) {
  case 'list': {
    const statusArg = parseArgValue(allArgs.find(a => a === '--status' || a.startsWith('--status=')));
    if (statusArg && !['pending', 'approved', 'denied'].includes(statusArg)) {
      fail('Usage: cli limit-requests list [--status pending|approved|denied] [--json]');
    }
    const rows = limitRequestRepository.list((statusArg ?? 'pending') as LimitRequestStatus);
    if (jsonMode) {
      process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    } else if (rows.length === 0) {
      console.log(`No ${statusArg ?? 'pending'} limit requests.`);
    } else {
      console.table(rows.map(row => ({
        id: row.id,
        namespace: row.namespace_name ?? row.namespace_id,
        tier: row.tier,
        email: row.email ?? '',
        note: row.note ?? '',
        status: row.status,
        created: row.created_at,
      })));
    }
    break;
  }
  case 'approve': {
    const id = Number(positional[0]);
    const tierArg = parseArgValue(allArgs.find(a => a === '--tier' || a.startsWith('--tier='))) ?? 'supporter';
    if (!Number.isInteger(id)) {
      fail(`Usage: cli limit-requests approve <id> [--tier ${USAGE_TIERS.join('|')}]`);
    }
    if (!isUsageTier(tierArg)) {
      fail(`Unknown tier "${tierArg}". Use one of: ${USAGE_TIERS.join(', ')}`);
    }
    const request = limitRequestRepository.get(id);
    if (!request || request.status !== 'pending') {
      fail(`No pending limit request with id ${id}.`);
    }
    StateService.setNamespaceTier(request.namespace_id, tierArg);
    limitRequestRepository.resolve(id, 'approved');
    console.log(`Approved request ${id}: namespace ${request.namespace_id} is now ${tierArg} (${tierLabel(tierArg)}).`);
    break;
  }
  case 'deny': {
    const id = Number(positional[0]);
    if (!Number.isInteger(id)) {
      fail('Usage: cli limit-requests deny <id>');
    }
    if (!limitRequestRepository.resolve(id, 'denied')) {
      fail(`No pending limit request with id ${id}.`);
    }
    console.log(`Denied request ${id}. The group can ask again later.`);
    break;
  }
  default:
    console.log(`
limit-requests <sub-command>
  list [--status pending|approved|denied] [--json]  Show "Ask for more" requests (default: pending)
  approve <id> [--tier supporter|unlimited|free]    Approve and set the group's tier (default: supporter)
  deny <id>                                         Close the request without changes
`);
  }
  break;
}

// ── email-outbox ──────────────────────────────────────────────────────────────

case 'email-outbox': {
  switch (subcommand) {
  case 'list': {
    const statusArg = parseArgValue(allArgs.find(a => a === '--status' || a.startsWith('--status=')));
    if (statusArg && !['pending', 'sent', 'failed', 'cancelled'].includes(statusArg)) {
      fail('Usage: cli email-outbox list [--status pending|sent|failed|cancelled] [--json]');
    }
    const rows = emailOutboxRepository.list(statusArg as EmailOutboxStatus | undefined)
      .map(({ text_body: _text, html_body: _html, ...row }) => row);
    if (jsonMode) {
      process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    } else if (rows.length === 0) {
      console.log('No notification emails found.');
    } else {
      console.table(rows.map(row => ({
        id: row.id,
        event: row.event_key,
        to: row.recipient,
        status: row.status,
        attempts: row.attempts,
        created: row.created_at,
        error: row.last_error ?? '',
      })));
    }
    break;
  }
  case 'send-test': {
    const [to] = positional;
    if (!to) {
      fail('Usage: cli email-outbox send-test <address>');
    }
    const provider = getEmailProvider();
    if (!provider) {
      fail('Email is not configured (EMAIL_PROVIDER / EMAIL_FROM / SES_REGION).');
    }
    try {
      const { messageId } = await provider.send({
        to,
        subject: 'Test email from dnd-fam-ftw',
        text: 'If you can read this, email delivery works. Check the headers for DKIM/SPF/DMARC pass and whether it landed in spam.',
        html: '<p>If you can read this, email delivery works. Check the headers for DKIM/SPF/DMARC pass and whether it landed in spam.</p>',
      });
      console.log(`Accepted by the provider (message id: ${messageId ?? 'n/a'}). Acceptance is not proof of inbox delivery.`);
    } catch (err) {
      fail(`Send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    break;
  }
  case 'retry': {
    const id = Number(positional[0]);
    if (!Number.isInteger(id)) {
      fail('Usage: cli email-outbox retry <id>');
    }
    if (!emailOutboxRepository.requeue(id, Date.now())) {
      fail(`No failed notification with id ${id}.`);
    }
    console.log(`Requeued notification ${id}. The running backend sends it within a few minutes.`);
    break;
  }
  default:
    console.log(`
email-outbox <sub-command>
  list [--status pending|sent|failed|cancelled] [--json]  Show operator notification emails (e.g. new signups)
  retry <id>                                               Requeue a failed notification
  send-test <address>                                      Send a test email now through the configured provider
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
  metrics         [--json] [--since <ISO date>] | narration [--json|--format csv] [--failed-only] [--namespace <id>] [--session <id>] [--since <ISO date>]
  invite-requests list [--json] | approve <email> [--namespace <name>] | clear
  limit-requests  list [--status <s>] [--json] | approve <id> [--tier <tier>] | deny <id>
  email-outbox    list [--status <s>] [--json] | retry <id> | send-test <address>

Run cli <resource> for sub-command help.

Examples:
  npm run cli -- users list
  npm run cli -- namespaces list
  npm run cli -- namespaces add-user <nsId> someone@gmail.com
  npm -s run cli -- sessions list --json | jq '.sessions[].displayName'
  npm -s run cli -- metrics --json | jq '.[].total_turns'
  npm -s run cli -- metrics narration --format csv
  npm run cli -- sessions export --output backup.json
  npm run cli -- sessions export --session abc123 --output session.json
  npm run cli -- sessions import backup.json --namespace-id xyz789
`);

}
