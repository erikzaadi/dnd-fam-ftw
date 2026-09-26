import os from 'os';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeDatabase } from '../persistence/database.js';
import type { SafeResolver } from '../lib/safeFetch.js';
import { DCR_PER_IP_PER_HOUR, isMetadataDocumentClientId, oauthClientService, parseMetadataDocument } from './clientService.js';

const DB_PATH = path.join(os.tmpdir(), `dnd-oauth-clients-test-${Date.now()}.sqlite`);

beforeAll(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
  initializeDatabase();
});

afterAll(() => {
  fs.rmSync(DB_PATH, { force: true });
});

describe('dynamic client registration', () => {
  it('registers a public client and finds it again', async () => {
    const result = oauthClientService.registerDynamicClient({ client_name: 'Codex', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' }, '203.0.113.1');
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.client.clientId).toMatch(/^dcr_/);
    const found = await oauthClientService.getClient(result.client.clientId);
    expect(found).toMatchObject({ kind: 'dcr', clientName: 'Codex', verifiedHost: null, redirectUris: ['http://127.0.0.1/callback'] });
  });

  it('refuses confidential clients and bad redirect URIs', () => {
    expect(oauthClientService.registerDynamicClient({ redirect_uris: ['http://127.0.0.1/cb'], token_endpoint_auth_method: 'client_secret_basic' }, '203.0.113.2'))
      .toMatchObject({ ok: false, error: 'invalid_client_metadata' });
    expect(oauthClientService.registerDynamicClient({ redirect_uris: ['http://example.com/cb'] }, '203.0.113.2'))
      .toMatchObject({ ok: false, error: 'invalid_redirect_uri' });
    expect(oauthClientService.registerDynamicClient({ redirect_uris: [] }, '203.0.113.2'))
      .toMatchObject({ ok: false, error: 'invalid_client_metadata' });
  });

  it('rate limits registrations per IP', () => {
    const now = Date.UTC(2026, 8, 27, 10);
    for (let i = 0; i < DCR_PER_IP_PER_HOUR; i++) {
      expect(oauthClientService.registerDynamicClient({ redirect_uris: ['http://127.0.0.1/cb'] }, '198.51.100.7', now).ok).toBe(true);
    }
    expect(oauthClientService.registerDynamicClient({ redirect_uris: ['http://127.0.0.1/cb'] }, '198.51.100.7', now)).toMatchObject({ ok: false, status: 429 });
    expect(oauthClientService.registerDynamicClient({ redirect_uris: ['http://127.0.0.1/cb'] }, '198.51.100.8', now).ok).toBe(true);
  });
});

describe('client ID metadata documents', () => {
  const url = 'https://client.example.com/oauth/metadata.json';

  it('accepts only https URLs with a path as metadata client ids', () => {
    expect(isMetadataDocumentClientId(url)).toBe(true);
    for (const id of ['http://client.example.com/meta', 'https://client.example.com/', 'https://client.example.com/meta?x=1', 'https://client.example.com/meta#f', 'dcr_abc']) {
      expect(isMetadataDocumentClientId(id)).toBe(false);
    }
  });

  it('validates the document against its own URL and the redirect rules', () => {
    expect(parseMetadataDocument(url, { client_id: url, client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }))
      .toEqual({ clientName: 'Claude', clientUri: null, redirectUris: ['https://claude.ai/api/mcp/auth_callback'] });
    expect(parseMetadataDocument(url, { client_id: 'https://other.example.com/meta', redirect_uris: ['https://a.example.com/cb'] })).toBeNull();
    expect(parseMetadataDocument(url, { client_id: url, redirect_uris: ['http://example.com/cb'] })).toBeNull();
    expect(parseMetadataDocument(url, { client_id: url, redirect_uris: ['https://a.example.com/cb'], token_endpoint_auth_method: 'private_key_jwt' })).toBeNull();
  });

  it('returns no client when the document host resolves to a private address', async () => {
    const privateResolver: SafeResolver = (_hostname, callback) => callback(null, [{ address: '169.254.169.254', family: 4 }]);
    expect(await oauthClientService.getClient(url, { resolver: privateResolver })).toBeNull();
    expect(await oauthClientService.getClient('not-a-client')).toBeNull();
  });
});
