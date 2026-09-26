import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertAuthConfig, resetConfigForTests } from '../config/env.js';
import { createMcpRouter } from '../mcp/server.js';

let server: Server;
let baseUrl: string;

const setOAuth = (enabled: boolean) => {
  process.env.MCP_OAUTH_ENABLED = enabled ? 'true' : 'false';
  resetConfigForTests();
};

beforeAll(async () => {
  process.env.AUTH_MODE = 'enabled';
  process.env.JWT_SECRET = 'oauth-discovery-test-secret-long-enough';
  process.env.EMAIL_PROVIDER = 'capture';
  process.env.MCP_ENABLED = 'true';
  process.env.MCP_PUBLIC_URL = 'https://api.example.com/mcp';
  process.env.FRONTEND_URL = 'https://play.example.com';
  resetConfigForTests();
  const app = express();
  app.use(express.json());
  app.use(createMcpRouter());
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  setOAuth(false);
});

afterAll(() => {
  server.close();
  delete process.env.MCP_OAUTH_ENABLED;
  resetConfigForTests();
});

describe('OAuth discovery', () => {
  it('is a plain 404 while MCP_OAUTH_ENABLED is off, and the challenge has no discovery hint', async () => {
    setOAuth(false);
    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server']) {
      expect((await fetch(`${baseUrl}${path}`)).status).toBe(404);
    }
    const res = await fetch(`${baseUrl}/mcp`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).not.toContain('resource_metadata');
  });

  it('publishes protected resource and authorization server metadata from configuration', async () => {
    setOAuth(true);
    const prm = await (await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`)).json() as Record<string, unknown>;
    expect(prm).toMatchObject({
      resource: 'https://api.example.com/mcp',
      authorization_servers: ['https://api.example.com'],
      bearer_methods_supported: ['header'],
    });
    expect(prm.scopes_supported).toContain('adventures:play');
    expect(prm.scopes_supported).not.toContain('offline_access');

    const as = await (await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)).json() as Record<string, unknown>;
    expect(as).toMatchObject({
      issuer: 'https://api.example.com',
      authorization_endpoint: 'https://api.example.com/oauth/authorize',
      token_endpoint: 'https://api.example.com/oauth/token',
      registration_endpoint: 'https://api.example.com/oauth/register',
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    expect((await fetch(`${baseUrl}/.well-known/openid-configuration`)).status).toBe(404);
  });

  it('points unauthenticated /mcp requests at the metadata', async () => {
    setOAuth(true);
    const res = await fetch(`${baseUrl}/mcp`, { method: 'POST' });
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp"');
    expect(challenge).toContain('scope="adventures:read adventures:play"');
  });
});

describe('MCP_OAUTH_ENABLED startup checks', () => {
  const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[key];
      }
    }
    resetConfigForTests();
    try {
      fn();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      resetConfigForTests();
    }
  };

  it('accepts a complete configuration', () => {
    withEnv({ MCP_OAUTH_ENABLED: 'true' }, () => expect(() => assertAuthConfig(false)).not.toThrow());
  });

  it('requires MCP_ENABLED, a root /mcp public URL, and FRONTEND_URL', () => {
    withEnv({ MCP_OAUTH_ENABLED: 'true', MCP_ENABLED: 'false' }, () => expect(() => assertAuthConfig(false)).toThrow(/MCP_ENABLED/));
    withEnv({ MCP_OAUTH_ENABLED: 'true', MCP_PUBLIC_URL: undefined }, () => expect(() => assertAuthConfig(false)).toThrow(/MCP_PUBLIC_URL/));
    withEnv({ MCP_OAUTH_ENABLED: 'true', MCP_PUBLIC_URL: 'https://example.com/dnd-fam-ftw/api/mcp' }, () => expect(() => assertAuthConfig(false)).toThrow(/MCP_PUBLIC_URL/));
    withEnv({ MCP_OAUTH_ENABLED: 'true', FRONTEND_URL: undefined }, () => expect(() => assertAuthConfig(false)).toThrow(/FRONTEND_URL/));
  });
});
