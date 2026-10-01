import os from 'os';
import path from 'path';
import fs from 'fs';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '../config/env.js';
import { initializeDatabase } from '../persistence/database.js';
import { signJwt } from '../services/authService.js';
import { removeMember } from '../services/namespaceMembershipService.js';
import { createAuthRouter } from './authRoutes.js';
import { accountService } from '../services/accountService.js';
import { realmAccess } from '../realms/access.js';

// Realm switching after losing access (architecture-deepening plan 2): a full sign-in
// whose cookie names a realm the user was removed from can still list and switch to
// its remaining memberships, but never back into the realm it lost.

const DB_PATH = path.join(os.tmpdir(), `dnd-realm-switch-test-${Date.now()}.sqlite`);
const ORIGIN = 'http://localhost:5173';
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.AUTH_MODE = 'enabled';
  process.env.JWT_SECRET = 'realm-switch-test-secret-long-enough-for-tests';
  process.env.FRONTEND_URL = ORIGIN;
  resetConfigForTests();
  initializeDatabase();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(createAuthRouter({ isProduction: false }));
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  delete process.env.AUTH_MODE;
  delete process.env.JWT_SECRET;
  delete process.env.FRONTEND_URL;
  resetConfigForTests();
  fs.rmSync(DB_PATH, { force: true });
});

const switchTo = (cookie: string, namespaceId: string) => fetch(`${baseUrl}/auth/session/namespace`, {
  method: 'POST',
  headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
  body: JSON.stringify({ namespaceId }),
});

describe('realm switching after losing access', () => {
  it('lists and switches to remaining realms, never back into the lost one', async () => {
    const host = accountService.createUser('switch-host@example.com');
    const memberEmail = 'switch-member@example.com';
    const member = accountService.createUser(memberEmail);
    realmAccess.addMember(member.userId, host.namespaceId);
    const cookie = `jwt=${signJwt({ email: memberEmail, namespaceId: host.namespaceId, type: 'full', userId: member.userId })}`;

    expect(removeMember(memberEmail, host.namespaceId)).toMatchObject({ ok: true });

    const listed = await fetch(`${baseUrl}/auth/session/namespaces`, { headers: { cookie } });
    expect(listed.status).toBe(200);
    const body = await listed.json() as { currentNamespaceId: string | null; namespaces: Array<{ id: string }> };
    expect(body.currentNamespaceId).toBeNull();
    expect(body.namespaces.map(namespace => namespace.id)).toEqual([member.namespaceId]);

    expect((await switchTo(cookie, host.namespaceId)).status).toBe(403);

    const switched = await switchTo(cookie, member.namespaceId);
    expect(switched.status).toBe(200);
    expect(switched.headers.get('set-cookie')).toContain('jwt=');
  });
});
