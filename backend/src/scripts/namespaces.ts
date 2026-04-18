/**
 * Namespace management CLI for dnd-fam-ftw.
 *
 * Usage (from repo root):
 *   npm run namespaces -- <command> [args]
 *
 * Commands:
 *   list                              List all namespaces with user and session counts
 *   create <name>                     Create a standalone namespace
 *   rename <id> <new-name>            Rename a namespace
 *   delete <id>                       Delete an empty namespace
 *   sessions <id>                     List sessions belonging to a namespace
 *   assign-session <sessionId> <nsId> Move a session to a different namespace
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env') });

import { StateService } from '../services/stateService.js';

const [, , command, ...args] = process.argv;

StateService.initialize();

switch (command) {
case 'list': {
  const ns = StateService.listNamespaces();
  if (ns.length === 0) {
    console.log('No namespaces found.');
  } else {
    console.log(`\n${'ID'.padEnd(12)} ${'Name'.padEnd(24)} ${'Users'.padEnd(7)} ${'Sessions'.padEnd(10)} Created`);
    console.log('-'.repeat(70));
    for (const n of ns) {
      console.log(`${n.id.padEnd(12)} ${n.name.padEnd(24)} ${String(n.user_count).padEnd(7)} ${String(n.session_count).padEnd(10)} ${n.created_at}`);
    }
    console.log();
  }
  break;
}

case 'create': {
  const name = args[0];
  if (!name) {
    console.error('Usage: namespaces.ts create <name>');
    process.exit(1);
  }
  const { namespaceId } = StateService.createNamespace(name);
  console.log(`Created namespace: "${name}"`);
  console.log(`  namespaceId: ${namespaceId}`);
  break;
}

case 'rename': {
  const [id, newName] = args;
  if (!id || !newName) {
    console.error('Usage: namespaces.ts rename <id> <new-name>');
    process.exit(1);
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
  const id = args[0];
  if (!id) {
    console.error('Usage: namespaces.ts delete <id>');
    process.exit(1);
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
  const id = args[0];
  if (!id) {
    console.error('Usage: namespaces.ts sessions <namespace-id>');
    process.exit(1);
  }
  const ns = StateService.getNamespaceById(id);
  if (!ns) {
    console.error(`Namespace not found: ${id}`);
    process.exit(1);
  }
  const sessions = StateService.listSessionsInNamespace(id);
  if (sessions.length === 0) {
    console.log(`No sessions in namespace "${ns.name}" (${id})`);
  } else {
    console.log(`\nSessions in "${ns.name}" (${id}):`);
    console.log(`${'ID'.padEnd(12)} ${'Name'.padEnd(28)} ${'Turn'.padEnd(6)} Created`);
    console.log('-'.repeat(65));
    for (const s of sessions) {
      console.log(`${s.id.padEnd(12)} ${s.displayName.padEnd(28)} ${String(s.turn).padEnd(6)} ${s.createdAt}`);
    }
    console.log();
  }
  break;
}

case 'assign-session': {
  const [sessionId, nsId] = args;
  if (!sessionId || !nsId) {
    console.error('Usage: namespaces.ts assign-session <sessionId> <namespaceId>');
    process.exit(1);
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

default:
  console.log(`
dnd-fam-ftw namespace management

Commands:
  list                                 List all namespaces with counts
  create <name>                        Create a standalone namespace
  rename <id> <new-name>               Rename a namespace
  delete <id>                          Delete an empty namespace
  sessions <id>                        List sessions in a namespace
  assign-session <sessionId> <nsId>    Move a session to a namespace

Examples:
  npm run namespaces -- list
  npm run namespaces -- create "Monitoring"
  npm run namespaces -- rename abc123 "Family Night"
  npm run namespaces -- sessions abc123
  npm run namespaces -- assign-session xyz789 abc123
  npm run namespaces -- delete abc123
`);
  break;
}
