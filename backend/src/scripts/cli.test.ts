import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StateService } from '../services/stateService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, 'cli.ts');
const DB_PATH = path.join(os.tmpdir(), `dnd-cli-test-${Date.now()}.sqlite`);
const IMG_PATH = path.join(os.tmpdir(), `dnd-cli-imgs-${Date.now()}`);

const BASE_ENV: Record<string, string> = {
  ...process.env as Record<string, string>,
  SQLITE_DB_PATH: DB_PATH,
  IMAGE_STORAGE_PROVIDER: 'local',
  LOCAL_IMAGE_STORAGE_PATH: IMG_PATH,
  LOCAL_IMAGE_PUBLIC_BASE_URL: '/test-images',
  OPENAI_API_KEY: 'test-key',
  OPENAI_BASE_URL: 'http://127.0.0.1:1',
};

function cli(...args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('npx', ['tsx', CLI_PATH, ...args], {
    env: BASE_ENV,
    encoding: 'utf8',
    timeout: 15_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
}

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.IMAGE_STORAGE_PROVIDER = 'local';
  process.env.LOCAL_IMAGE_STORAGE_PATH = IMG_PATH;
  process.env.LOCAL_IMAGE_PUBLIC_BASE_URL = '/test-images';
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1';
  StateService.initialize();
});

afterAll(() => {
  try {
    fs.unlinkSync(DB_PATH);
  } catch {
    // ignore
  }
});

// ── users ─────────────────────────────────────────────────────────────────────

describe('CLI users', () => {
  it('add creates a user and prints confirmation', () => {
    const { stdout, status } = cli('users', 'add', 'cli-hero@example.com');
    expect(status).toBe(0);
    expect(stdout).toContain('Created user');
    expect(stdout).toContain('cli-hero@example.com');
    expect(stdout).toContain('userId');
    expect(stdout).toContain('namespaceId');
  });

  it('list --json returns array containing the created user', () => {
    const { stdout, status } = cli('users', 'list', '--json');
    expect(status).toBe(0);
    const users = JSON.parse(stdout) as { email: string }[];
    expect(Array.isArray(users)).toBe(true);
    expect(users.some(u => u.email === 'cli-hero@example.com')).toBe(true);
  });

  it('add fails with exit 1 for duplicate email', () => {
    const { status } = cli('users', 'add', 'cli-hero@example.com');
    expect(status).toBe(1);
  });

  it('remove deletes the user', () => {
    const { stdout, status } = cli('users', 'remove', 'cli-hero@example.com');
    expect(status).toBe(0);
    expect(stdout).toContain('Deleted user');
  });

  it('remove fails with exit 1 for unknown email', () => {
    const { status } = cli('users', 'remove', 'ghost@example.com');
    expect(status).toBe(1);
  });
});

// ── namespaces ────────────────────────────────────────────────────────────────

describe('CLI namespaces', () => {
  it('create makes a namespace', () => {
    const { stdout, status } = cli('namespaces', 'create', 'Test Realm');
    expect(status).toBe(0);
    expect(stdout).toContain('Test Realm');
    expect(stdout).toContain('namespaceId');
  });

  it('list --json returns array containing created namespace', () => {
    const { stdout, status } = cli('namespaces', 'list', '--json');
    expect(status).toBe(0);
    const ns = JSON.parse(stdout) as { name: string }[];
    expect(ns.some(n => n.name === 'Test Realm')).toBe(true);
  });

  it('rename updates the namespace name', () => {
    const createOut = cli('namespaces', 'create', 'Old Name').stdout;
    const nsId = createOut.match(/namespaceId:\s*(\S+)/)?.[1];
    expect(nsId).toBeTruthy();
    const { stdout, status } = cli('namespaces', 'rename', nsId!, 'New Name');
    expect(status).toBe(0);
    expect(stdout).toContain('New Name');
  });

  it('rename fails with exit 1 for unknown id', () => {
    expect(cli('namespaces', 'rename', 'no-such-id', 'Whatever').status).toBe(1);
  });

  it('delete removes an empty namespace', () => {
    const nsId = cli('namespaces', 'create', 'Doomed Realm').stdout.match(/namespaceId:\s*(\S+)/)?.[1];
    expect(nsId).toBeTruthy();
    const { stdout, status } = cli('namespaces', 'delete', nsId!);
    expect(status).toBe(0);
    expect(stdout).toContain('Deleted');
  });

  it('delete fails for local namespace', () => {
    expect(cli('namespaces', 'delete', 'local').status).toBe(1);
  });

  it('add-user grants access and remove-user revokes it', () => {
    cli('users', 'add', 'ns-member@example.com');
    const nsId = cli('namespaces', 'create', 'Shared Realm').stdout.match(/namespaceId:\s*(\S+)/)?.[1];
    expect(nsId).toBeTruthy();
    const addOut = cli('namespaces', 'add-user', nsId!, 'ns-member@example.com');
    expect(addOut.status).toBe(0);
    expect(addOut.stdout).toContain('Granted');
    const removeOut = cli('namespaces', 'remove-user', nsId!, 'ns-member@example.com');
    expect(removeOut.status).toBe(0);
    expect(removeOut.stdout).toContain('Removed');
  });

  it('set-limits with --max-sessions=N --max-turns=N sets limits', () => {
    const nsId = cli('namespaces', 'create', 'Limited Realm').stdout.match(/namespaceId:\s*(\S+)/)?.[1];
    expect(nsId).toBeTruthy();
    const { stdout, status } = cli('namespaces', 'set-limits', nsId!, '--max-sessions=3', '--max-turns=50');
    expect(status).toBe(0);
    expect(stdout).toMatch(/max-sessions:\s+3/);
    expect(stdout).toMatch(/max-turns:\s+50/);
  });

  it('set-limits with --max-sessions null removes the limit', () => {
    const nsId = cli('namespaces', 'create', 'Unlimit Realm').stdout.match(/namespaceId:\s*(\S+)/)?.[1];
    expect(nsId).toBeTruthy();
    cli('namespaces', 'set-limits', nsId!, '--max-sessions=5');
    const { stdout, status } = cli('namespaces', 'set-limits', nsId!, '--max-sessions', 'null');
    expect(status).toBe(0);
    expect(stdout).toContain('max-sessions: unlimited');
  });

  it('set-limits with no flags shows current limits', () => {
    const nsId = cli('namespaces', 'create', 'View Realm').stdout.match(/namespaceId:\s*(\S+)/)?.[1];
    expect(nsId).toBeTruthy();
    const { stdout, status } = cli('namespaces', 'set-limits', nsId!);
    expect(status).toBe(0);
    expect(stdout).toContain('max-sessions');
    expect(stdout).toContain('max-turns');
  });
});

// ── sessions export / import ──────────────────────────────────────────────────

describe('CLI sessions export/import', () => {
  it('export produces valid JSON with sessions array', () => {
    const { stdout, status } = cli('sessions', 'export');
    expect(status).toBe(0);
    const data = JSON.parse(stdout) as { version: number; sessions: unknown[] };
    expect(data.version).toBe(1);
    expect(Array.isArray(data.sessions)).toBe(true);
  });

  it('export --output writes to file', () => {
    const outFile = path.join(os.tmpdir(), `cli-export-${Date.now()}.json`);
    try {
      const { status } = cli('sessions', 'export', '--output', outFile);
      expect(status).toBe(0);
      expect(fs.existsSync(outFile)).toBe(true);
      const data = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { version: number; sessions: unknown[] };
      expect(data.version).toBe(1);
    } finally {
      try {
        fs.unlinkSync(outFile);
      } catch {
        // ignore
      }
    }
  });

  it('import round-trips a session', () => {
    const exportFile = path.join(os.tmpdir(), `cli-roundtrip-${Date.now()}.json`);
    try {
      // Seed a session directly via DB so we have something to export
      const db = (StateService as unknown as { db: import('libsql').Database }).db;
      db.prepare(
        'INSERT INTO sessions (id, scene, sceneId, worldDescription, dm_prep, dm_prep_image_brief, turn, tone, displayName, difficulty, gameMode, useLocalAI, savingsMode, namespace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'export-test-sess',
        'A Cave',
        'cave-1',
        'Export world',
        'Verbose prep for export',
        'visual cave brief',
        1,
        'thrilling',
        'Export Test World',
        'normal',
        'balanced',
        0,
        0,
        'local',
      );

      cli('sessions', 'export', '--session', 'export-test-sess', '--output', exportFile);
      expect(fs.existsSync(exportFile)).toBe(true);

      // Delete it then reimport
      db.prepare('DELETE FROM sessions WHERE id = ?').run('export-test-sess');

      const { stdout, status } = cli('sessions', 'import', exportFile);
      expect(status).toBe(0);
      expect(stdout).toContain('Export Test World');
      expect(stdout).toContain('Imported 1 session');
      const imported = db.prepare('SELECT dm_prep_image_brief FROM sessions WHERE id = ?').get('export-test-sess') as { dm_prep_image_brief: string };
      expect(imported.dm_prep_image_brief).toBe('visual cave brief');
    } finally {
      try {
        fs.unlinkSync(exportFile);
      } catch {
        // ignore
      }
    }
  });

  it('import fails with exit 1 for missing file', () => {
    expect(cli('sessions', 'import', '/tmp/nonexistent-file.json').status).toBe(1);
  });
});

// ── metrics ───────────────────────────────────────────────────────────────────

describe('CLI metrics', () => {
  it('--json returns array of namespace metrics', () => {
    const { stdout, status } = cli('metrics', '--json');
    expect(status).toBe(0);
    const rows = JSON.parse(stdout) as { namespace_id: string; session_count: number }[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.every(r => 'namespace_id' in r && 'session_count' in r)).toBe(true);
  });
});

// ── invite-requests ───────────────────────────────────────────────────────────

describe('CLI invite-requests', () => {
  it('list returns empty message when no requests', () => {
    cli('invite-requests', 'clear');
    const { stdout, status } = cli('invite-requests', 'list');
    expect(status).toBe(0);
    expect(stdout).toContain('No pending');
  });

  it('list --json shows invite requests after they are added', () => {
    StateService.addInviteRequest('cli-invite@example.com', 'Let me in!');
    const { stdout, status } = cli('invite-requests', 'list', '--json');
    expect(status).toBe(0);
    const requests = JSON.parse(stdout) as { email: string }[];
    expect(requests.some(r => r.email === 'cli-invite@example.com')).toBe(true);
  });

  it('clear removes all invite requests', () => {
    const { stdout, status } = cli('invite-requests', 'clear');
    expect(status).toBe(0);
    expect(stdout).toMatch(/Cleared \d+ invite request/);
    expect(cli('invite-requests', 'list', '--json').stdout.trim()).toBe('[]');
  });
});
