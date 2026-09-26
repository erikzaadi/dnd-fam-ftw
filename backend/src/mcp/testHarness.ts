import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { getDb } from '../persistence/database.js';
import { userRepository } from '../repositories/userRepository.js';
import { accessTokenService } from '../services/accessTokenService.js';
import type { AccessTokenScope } from '../types.js';
import { createMcpRouter } from './server.js';

// Test-only helpers for MCP HTTP tests: a pilot user with a token, a seeded session,
// and JSON-RPC calls against a real /mcp router.

export type ToolResponse = {
  status: number;
  text: string;
  body: { result?: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: { type: string; text: string }[]; tools?: { name: string }[] }; error?: unknown } | null;
};

export const startMcpServer = (): { server: Server; baseUrl: string } => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(createMcpRouter());
  const server = app.listen(0);
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

// Config is parsed once on first use: call before anything touches the database.
export const setMcpTestEnv = (dbPath?: string): void => {
  if (dbPath) {
    process.env.SQLITE_DB_PATH = dbPath;
  }
  process.env.AUTH_MODE = 'enabled';
  process.env.JWT_SECRET = 'mcp-test-secret-that-is-long-enough-to-pass';
  process.env.MCP_ENABLED = 'true';
  process.env.IMAGE_STORAGE_PROVIDER = 'local';
};

export const createPilot = (email: string, scopes: AccessTokenScope[] = ['adventures:play', 'adventures:create']) => {
  const { userId, namespaceId } = userRepository.createUser(email);
  userRepository.setMcpAccess(userId, 'on');
  const minted = accessTokenService.create({ userId, namespaceId, label: email, scopes });
  if (!minted.ok) {
    throw new Error(`could not mint token: ${minted.error}`);
  }
  return { userId, namespaceId, secret: minted.secret, tokenId: minted.token.id };
};

export const insertSession = (id: string, namespaceId: string, displayName: string, dmPrep: string | null = null): string => {
  const heroId = `${id}-hero`;
  getDb().prepare(
    'INSERT INTO sessions (id, scene, sceneId, worldDescription, turn, tone, displayName, difficulty, gameMode, useLocalAI, savingsMode, namespace_id, dm_prep, activeCharacterId, adventure_format) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, 'A mossy bridge', 'bridge-1', 'A world of trolls', 2, 'silly', displayName, 'normal', 'balanced', 0, 1, namespaceId, dmPrep, heroId, 'one_evening');
  getDb().prepare(
    'INSERT INTO characters (id, sessionId, name, class, species, quirk, hp, max_hp, might, magic, mischief, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(heroId, id, 'Pip', 'Bard', 'Gnome', 'Hums constantly', 8, 10, 1, 2, 3, 'active');
  return heroId;
};

export const makeRpc = (baseUrl: string) => async (method: string, params: Record<string, unknown>, headers: Record<string, string> = {}): Promise<ToolResponse & { headers: Headers }> => {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) as ToolResponse['body'] : null, headers: res.headers };
};

export const makeCallTool = (baseUrl: string) => {
  const rpc = makeRpc(baseUrl);
  return (secret: string, name: string, args: Record<string, unknown>) =>
    rpc('tools/call', { name, arguments: args }, { Authorization: `Bearer ${secret}` });
};
