/**
 * User management CLI for dnd-fam-ftw.
 *
 * Usage (from repo root):
 *   npx tsx backend/src/scripts/users.ts <command> [args]
 *
 * Commands:
 *   list                     List all users
 *   add <email> [namespace]  Create a new user (and their namespace)
 *   remove <email>           Delete a user (and their namespace if empty)
 *   set-primary <e> <ns>     Change a user's primary namespace
 *   namespaces               List all namespaces
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env'), quiet: true });

import { StateService } from '../services/stateService.js';

const [, , command, ...args] = process.argv;
const jsonMode = process.argv.includes('--json');

StateService.initialize();

switch (command) {
case 'list': {
  const users = StateService.listUsers();
  if (jsonMode) {
    console.log(JSON.stringify(users, null, 2));
  } else if (users.length === 0) {
    console.log('No users found.');
  } else {
    console.log(`\n${'Email'.padEnd(35)} ${'Namespace'.padEnd(20)} ${'Role'.padEnd(8)} Created`);
    console.log('-'.repeat(80));
    for (const u of users) {
      console.log(`${u.email.padEnd(35)} ${u.namespace_name.padEnd(20)} ${u.role.padEnd(8)} ${u.created_at}`);
    }
    console.log();
  }
  break;
}

case 'add': {
  const email = args[0];
  const namespaceName = args[1];
  if (!email) {
    console.error('Usage: users.ts add <email> [namespace-name]');
    process.exit(1);
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
  const email = args[0];
  if (!email) {
    console.error('Usage: users.ts remove <email>');
    process.exit(1);
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
  const [email, namespaceId] = args;
  if (!email || !namespaceId) {
    console.error('Usage: users.ts set-primary <email> <namespaceId>');
    process.exit(1);
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
case 'namespaces': {
  const namespaces = StateService.listNamespaces();
  if (jsonMode) {
    console.log(JSON.stringify(namespaces, null, 2));
  } else if (namespaces.length === 0) {
    console.log('No namespaces found.');
  } else {
    console.log(`\n${'ID'.padEnd(12)} ${'Name'.padEnd(20)} Created`);
    console.log('-'.repeat(50));
    for (const n of namespaces) {
      console.log(`${n.id.padEnd(12)} ${n.name.padEnd(20)} ${n.created_at}`);
    }
    console.log();
  }
  break;
}

default:
  console.log(`
dnd-fam-ftw user management

Commands:
  list                     List all users
  add <email> [namespace]  Create a new user (and their namespace)
  remove <email>           Delete a user (and their namespace if empty)
  set-primary <e> <ns>     Change a user's primary namespace
  namespaces               List all namespaces

Examples:
  npx tsx backend/src/scripts/users.ts list
  npx tsx backend/src/scripts/users.ts add family@gmail.com "Erikzaadi Family"
  npx tsx backend/src/scripts/users.ts remove old@gmail.com
  npx tsx backend/src/scripts/users.ts set-primary family@gmail.com ns123
  npx tsx backend/src/scripts/users.ts namespaces
`);
  break;
}
