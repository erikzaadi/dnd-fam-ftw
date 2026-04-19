/**
 * Invite requests management CLI.
 *
 * Usage (from repo root):
 *   npm run invite-requests list
 *   npm run invite-requests clear
 *
 * Or on production via run-script.sh:
 *   ./scripts/deploy/run-script.sh invite-requests list
 *   ./scripts/deploy/run-script.sh invite-requests clear
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env'), quiet: true });

import { StateService } from '../services/stateService.js';

const [, , command] = process.argv;
const jsonMode = process.argv.includes('--json');

StateService.initialize();

switch (command) {
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
dnd-fam-ftw invite requests management

Commands:
  list    Show all pending invite requests
  clear   Delete all invite requests

Options:
  --json  Output as JSON (list only)

Examples:
  npm run invite-requests list
  npm run invite-requests list --json | jq '.[].email'
  npm run invite-requests clear
`);
  break;
}
