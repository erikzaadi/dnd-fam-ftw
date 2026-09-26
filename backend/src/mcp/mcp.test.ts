import os from 'os';
import path from 'path';
import fs from 'fs';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../persistence/database.js';
import { userRepository } from '../repositories/userRepository.js';
import { accessTokenService } from '../services/accessTokenService.js';
import { StateService } from '../services/stateService.js';
import { resetMcpRateLimits } from './auth.js';
import { createMcpRouter } from './server.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-mcp-test-${Date.now()}.sqlite`);
const SENTINEL = 'SENTINEL_PRIVATE_DM_MATERIAL';

let server: Server;
let baseUrl: string;
let secretA: string;
let secretB: string;

const insertSession = (id: string, namespaceId: string, displayName: string) => {
  getDb().prepare(
    'INSERT INTO sessions (id, scene, sceneId, worldDescription, turn, tone, displayName, difficulty, gameMode, useLocalAI, savingsMode, namespace_id, dm_prep) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, 'A mossy bridge', 'bridge-1', 'A world of trolls', 2, 'silly', displayName, 'normal', 'balanced', 0, 1, namespaceId, `Troll secretly loves ${SENTINEL}`);
  getDb().prepare(
    'INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(`${id}-hero`, id, 'Pip', 'Bard', 'Gnome', 'Hums constantly', 8, 10, 1, 2, 3, 'active');
};

const rpc = async (method: string, params: Record<string, unknown>, headers: Record<string, string> = {}) => {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) as { result?: Record<string, unknown>; error?: unknown } : null, headers: res.headers };
};

const callTool = (secret: string, name: string, args: Record<string, unknown>) =>
  rpc('tools/call', { name, arguments: args }, { Authorization: `Bearer ${secret}` });

beforeAll(async () => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.AUTH_MODE = 'enabled';
  process.env.JWT_SECRET = 'mcp-test-secret-that-is-long-enough-to-pass';
  process.env.MCP_ENABLED = 'true';
  process.env.IMAGE_STORAGE_PROVIDER = 'local';
  StateService.initialize();

  const a = userRepository.createUser('pilot-a@example.com');
  const b = userRepository.createUser('pilot-b@example.com');
  userRepository.setMcpAccess(a.userId, 'on');
  userRepository.setMcpAccess(b.userId, 'on');
  insertSession('sess-a', a.namespaceId, 'Troll Bridge');
  insertSession('sess-b', b.namespaceId, 'Other Family');
  await StateService.addTurnResult('sess-a', {
    narration: 'The troll blocks the bridge and asks a riddle.',
    imagePrompt: `private prompt ${SENTINEL}`,
    imageSuggested: false,
    imageUrl: '/generated/secret-scene.png',
    choices: [{ label: 'Answer: a shadow', difficulty: 'easy', stat: 'magic', riddleAnswer: SENTINEL, riddleCorrect: true } as never],
    lastAction: { actionAttempt: 'Pip dances for the troll', actionResult: { success: true, roll: 14, statUsed: 'mischief', difficultyTarget: 12 } },
  }, 'sess-a-hero');

  const mintA = accessTokenService.create({ userId: a.userId, namespaceId: a.namespaceId, label: 'A', scopes: [] });
  const mintB = accessTokenService.create({ userId: b.userId, namespaceId: b.namespaceId, label: 'B', scopes: [] });
  if (!mintA.ok || !mintB.ok) {
    throw new Error('could not mint test tokens');
  }
  secretA = mintA.secret;
  secretB = mintB.secret;

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(createMcpRouter());
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  resetMcpRateLimits();
});

afterAll(() => {
  server?.close();
  fs.rmSync(DB_PATH, { force: true });
});

describe('/mcp authentication', () => {
  it('requires a bearer token and ignores website cookies', async () => {
    const missing = await rpc('tools/list', {});
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toMatch(/^Bearer /);

    const cookieOnly = await rpc('tools/list', {}, { Cookie: 'jwt=anything' });
    expect(cookieOnly.status).toBe(401);
  });

  it('rejects unknown and revoked tokens', async () => {
    expect((await callTool('dndmcp_unknown', 'list_adventures', {})).status).toBe(401);
    const user = userRepository.createUser('pilot-revoked@example.com');
    userRepository.setMcpAccess(user.userId, 'on');
    const minted = accessTokenService.create({ userId: user.userId, namespaceId: user.namespaceId, label: 'R', scopes: [] });
    if (!minted.ok) {
      throw new Error('mint failed');
    }
    expect((await callTool(minted.secret, 'list_adventures', {})).status).toBe(200);
    accessTokenService.revoke(user.userId, minted.token.id);
    expect((await callTool(minted.secret, 'list_adventures', {})).status).toBe(401);
  });

  it('answers OAuth discovery probes with 404, not a login challenge', async () => {
    for (const probe of ['/mcp/.well-known/openid-configuration', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server']) {
      expect((await fetch(`${baseUrl}${probe}`)).status).toBe(404);
    }
  });

  it('answers only POST', async () => {
    const res = await fetch(`${baseUrl}/mcp`, { headers: { Authorization: `Bearer ${secretA}`, Accept: 'text/event-stream' } });
    expect(res.status).toBe(405);
  });
});

describe('/mcp tools', () => {
  it('lists the read tools', async () => {
    const { status, body } = await rpc('tools/list', {}, { Authorization: `Bearer ${secretA}` });
    expect(status).toBe(200);
    const names = (body?.result?.tools as { name: string }[]).map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining(['list_adventures', 'get_adventure']));
  });

  it('lists only adventures in the token namespace', async () => {
    const { body } = await callTool(secretA, 'list_adventures', {});
    const structured = body?.result?.structuredContent as { adventures: { id: string; title: string }[]; nextCursor: string | null };
    expect(structured.adventures.map(adventure => adventure.id)).toEqual(['sess-a']);
    expect(structured.adventures[0].title).toBe('Troll Bridge');
    expect(structured.nextCursor).toBeNull();
  });

  it('reads an adventure without private DM material or image URLs', async () => {
    const { text, body } = await callTool(secretA, 'get_adventure', { adventureId: 'sess-a' });
    expect(body?.result?.isError).toBeFalsy();
    const view = body?.result?.structuredContent as { title: string; party: { name: string }[]; history: { narration: string; hasImage: boolean; action: { text: string } | null }[] };
    expect(view.title).toBe('Troll Bridge');
    expect(view.party.map(hero => hero.name)).toEqual(['Pip']);
    expect(view.history).toHaveLength(1);
    expect(view.history[0]).toMatchObject({ narration: 'The troll blocks the bridge and asks a riddle.', hasImage: true, action: { text: 'Pip dances for the troll' } });
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('secret-scene.png');
  });

  it('treats another namespace\'s adventure as missing', async () => {
    const { body } = await callTool(secretB, 'get_adventure', { adventureId: 'sess-a' });
    expect(body?.result?.isError).toBe(true);
    expect(JSON.stringify(body)).not.toContain('Troll Bridge');
  });
});
