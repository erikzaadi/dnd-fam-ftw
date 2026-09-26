import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeDatabase } from '../persistence/database.js';
import { emailOutboxRepository } from '../repositories/emailOutboxRepository.js';
import { mcpAccessRequestRepository } from '../repositories/mcpAccessRequestRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { isMcpEligible } from './accessTokenService.js';
import { MAX_REQUESTS_PER_WINDOW, mcpAccessRequestService } from './mcpAccessRequestService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-mcp-access-requests-test-${Date.now()}.sqlite`);

let seq = 0;
const freeUser = () => {
  const email = `free${++seq}@example.com`;
  const { userId, namespaceId } = userRepository.createUser(email, undefined, 'member', 'free');
  return { userId, namespaceId, email };
};

const outboxKeys = () => emailOutboxRepository.list().map(row => row.event_key);

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  process.env.AUTH_MODE = 'enabled';
  process.env.JWT_SECRET = 'mcp-access-request-test-secret-long-enough';
  process.env.MCP_ENABLED = 'true';
  process.env.EMAIL_PROVIDER = 'capture';
  process.env.SIGNUP_NOTIFY_EMAIL = 'keeper@example.com';
  initializeDatabase();
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

describe('mcpAccessRequestService', () => {
  it('lets a free player ask once, notifies the keeper, and shows the open request', () => {
    const user = freeUser();
    expect(mcpAccessRequestService.getState(user.userId, user.namespaceId)).toEqual({ canRequestAccess: true, accessRequest: null });

    const result = mcpAccessRequestService.request({ ...user, note: 'Claude Code please' });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(outboxKeys()).toContain(`mcp-access-request:${result.requestId}`);
    expect(mcpAccessRequestService.request({ ...user, note: null })).toEqual({ ok: false, error: 'already_requested' });

    const state = mcpAccessRequestService.getState(user.userId, user.namespaceId);
    expect(state.canRequestAccess).toBe(false);
    expect(state.accessRequest?.status).toBe('pending');
  });

  it('approving turns access on and emails the player', () => {
    const user = freeUser();
    const result = mcpAccessRequestService.request({ ...user, note: null });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(mcpAccessRequestService.approve(result.requestId)?.email).toBe(user.email);
    expect(userRepository.getMcpAccess(user.userId)).toBe('on');
    expect(isMcpEligible(user.userId, user.namespaceId)).toBe(true);
    expect(outboxKeys()).toContain(`mcp-access-granted:${result.requestId}`);
    expect(mcpAccessRequestService.getState(user.userId, user.namespaceId)).toEqual({ canRequestAccess: false, accessRequest: null });
    expect(mcpAccessRequestService.approve(result.requestId)).toBeNull();
  });

  it('after a denial the player may ask again, up to the monthly cap', () => {
    const user = freeUser();
    const now = Date.now();
    for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i++) {
      const result = mcpAccessRequestService.request({ ...user, note: null, now: now + i });
      if (!result.ok) {
        throw new Error(result.error);
      }
      expect(mcpAccessRequestService.deny(result.requestId, now + i)).toBe(true);
    }
    const state = mcpAccessRequestService.getState(user.userId, user.namespaceId, now + 10);
    expect(state).toEqual({ canRequestAccess: false, accessRequest: { status: 'denied', createdAt: new Date(now + MAX_REQUESTS_PER_WINDOW - 1).toISOString() } });
    expect(mcpAccessRequestService.request({ ...user, note: null, now: now + 10 })).toEqual({ ok: false, error: 'too_many_requests' });
  });

  it('refuses blocked players and players who already have access', () => {
    const blocked = freeUser();
    userRepository.setMcpAccess(blocked.userId, 'off');
    expect(mcpAccessRequestService.request({ ...blocked, note: null })).toEqual({ ok: false, error: 'not_available' });
    expect(mcpAccessRequestService.getState(blocked.userId, blocked.namespaceId).canRequestAccess).toBe(false);

    const founder = userRepository.createUser('founder-request@example.com', undefined, 'member', 'unlimited');
    expect(mcpAccessRequestService.request({ ...founder, email: 'founder-request@example.com', note: null })).toEqual({ ok: false, error: 'not_needed' });
  });

  it('removes requests with the user', () => {
    const user = freeUser();
    mcpAccessRequestService.request({ ...user, note: null });
    userRepository.deleteUser(user.email);
    expect(mcpAccessRequestRepository.getLatestForUser(user.userId)).toBeNull();
  });
});
