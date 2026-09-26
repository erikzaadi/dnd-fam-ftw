import crypto from 'crypto';
import { z } from 'zod';
import { safeFetchJson, type SafeResolver } from '../lib/safeFetch.js';
import { authChallengeRepository } from '../repositories/authChallengeRepository.js';
import { oauthClientRepository, type OAuthClientKind, type OAuthClientRow } from '../repositories/oauthClientRepository.js';
import { isAllowedRedirectUri, MAX_REDIRECT_URIS } from './redirectUris.js';

// MCP OAuth clients. Two ways to exist:
// - Client ID Metadata Documents: the client_id is an https URL; we fetch the JSON
//   document there (SSRF-safe, small, cached) and trust its redirect URIs. The URL's
//   host is the verified identity shown on the consent page.
// - Dynamic Client Registration (POST /oauth/register): anyone may register a public
//   client; its name is self-declared, so it is shown as an unverified app.
// Only public clients (no secrets, PKCE required) are supported.

export type OAuthClient = {
  clientId: string;
  kind: OAuthClientKind;
  clientName: string | null;
  clientUri: string | null;
  redirectUris: string[];
  // Host of a Client ID Metadata Document URL; null for self-registered clients.
  verifiedHost: string | null;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const DCR_PER_IP_PER_HOUR = 20;
export const DCR_PER_DAY = 500;
const DCR_UNUSED_LIFETIME_MS = 30 * DAY_MS;

const METADATA_MAX_BYTES = 5 * 1024;
const METADATA_TIMEOUT_MS = 3000;
const METADATA_MIN_CACHE_S = 5 * 60;
const METADATA_DEFAULT_CACHE_S = 60 * 60;
const METADATA_MAX_CACHE_S = 24 * 60 * 60;

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const optionalHttpsUrl = z.string().max(512).refine(value => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}).optional();

// RFC 7591 client metadata, restricted to what a public PKCE client can use. Unknown
// fields are ignored, as the RFC allows. Extra grant types are ignored too (Claude's
// metadata document also lists jwt-bearer); the token endpoint only honors ours, but
// authorization_code must be among them.
const clientMetadataSchema = z.object({
  redirect_uris: z.array(z.string()).min(1).max(MAX_REDIRECT_URIS),
  client_name: optionalText(100),
  client_uri: optionalHttpsUrl,
  token_endpoint_auth_method: z.literal('none').optional(),
  grant_types: z.array(z.string().max(200)).max(10).refine(types => types.includes('authorization_code')).optional(),
  response_types: z.array(z.literal('code')).optional(),
});

export const toOAuthClient = (row: OAuthClientRow): OAuthClient => ({
  clientId: row.client_id,
  kind: row.kind,
  clientName: row.client_name,
  clientUri: row.client_uri,
  redirectUris: JSON.parse(row.redirect_uris) as string[],
  verifiedHost: row.kind === 'cimd' ? new URL(row.client_id).hostname : null,
});

// A metadata document client id: https, a DNS host, a path, no query/fragment/credentials.
export const isMetadataDocumentClientId = (clientId: string): boolean => {
  if (clientId.length > 512) {
    return false;
  }
  try {
    const url = new URL(clientId);
    return url.protocol === 'https:' && url.pathname !== '/' && !url.search && !url.hash && !url.username && !url.password && url.href === clientId;
  } catch {
    return false;
  }
};

// Validates a fetched Client ID Metadata Document for the URL it came from.
export const parseMetadataDocument = (clientId: string, body: unknown): { clientName: string | null; clientUri: string | null; redirectUris: string[] } | null => {
  const parsed = clientMetadataSchema.extend({ client_id: z.string() }).safeParse(body);
  if (!parsed.success || parsed.data.client_id !== clientId || !parsed.data.redirect_uris.every(isAllowedRedirectUri)) {
    return null;
  }
  return { clientName: parsed.data.client_name ?? null, clientUri: parsed.data.client_uri ?? null, redirectUris: parsed.data.redirect_uris };
};

export type RegisterClientResult =
  | { ok: true; client: OAuthClient; issuedAt: number }
  | { ok: false; status: number; error: 'invalid_redirect_uri' | 'invalid_client_metadata' | 'rate_limited'; description: string };

export type ClientLookupOptions = { now?: number; resolver?: SafeResolver };

export const oauthClientService = {
  registerDynamicClient(body: unknown, ip: string, now: number = Date.now()): RegisterClientResult {
    const parsed = clientMetadataSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, status: 400, error: 'invalid_client_metadata', description: 'Only public clients using the authorization code flow with PKCE are supported.' };
    }
    if (!parsed.data.redirect_uris.every(isAllowedRedirectUri)) {
      return { ok: false, status: 400, error: 'invalid_redirect_uri', description: 'Redirect URIs must be https, or http on 127.0.0.1, [::1], or localhost.' };
    }
    const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
    const day = Math.floor(now / DAY_MS) * DAY_MS;
    if (authChallengeRepository.incrementRateLimit(`oauth-dcr-ip:${ip}`, hour) > DCR_PER_IP_PER_HOUR
      || authChallengeRepository.incrementRateLimit('oauth-dcr-all', day) > DCR_PER_DAY) {
      return { ok: false, status: 429, error: 'rate_limited', description: 'Too many registrations. Try again later.' };
    }
    oauthClientRepository.pruneUnusedDynamic(now - DCR_UNUSED_LIFETIME_MS);
    const clientId = `dcr_${crypto.randomBytes(18).toString('base64url')}`;
    oauthClientRepository.insertDynamic({
      clientId,
      clientName: parsed.data.client_name ?? null,
      clientUri: parsed.data.client_uri ?? null,
      redirectUris: parsed.data.redirect_uris,
      now,
    });
    return { ok: true, client: toOAuthClient(oauthClientRepository.get(clientId)!), issuedAt: now };
  },

  // Resolves a client id to a client, fetching (or refreshing) its metadata document
  // when the id is an https URL. Returns null for unknown or invalid clients.
  async getClient(clientId: string, options: ClientLookupOptions = {}): Promise<OAuthClient | null> {
    const now = options.now ?? Date.now();
    const row = oauthClientRepository.get(clientId);
    if (row && (row.kind === 'dcr' || (row.cache_until !== null && row.cache_until > now))) {
      return toOAuthClient(row);
    }
    if (!isMetadataDocumentClientId(clientId)) {
      return null;
    }
    try {
      const { body, maxAgeSeconds } = await safeFetchJson(clientId, { maxBytes: METADATA_MAX_BYTES, timeoutMs: METADATA_TIMEOUT_MS, resolver: options.resolver });
      const document = parseMetadataDocument(clientId, body);
      if (!document) {
        console.warn(`[OAuth] Rejected client metadata document ${clientId}: invalid document`);
        return null;
      }
      const cacheSeconds = Math.min(Math.max(maxAgeSeconds ?? METADATA_DEFAULT_CACHE_S, METADATA_MIN_CACHE_S), METADATA_MAX_CACHE_S);
      oauthClientRepository.upsertMetadataDocument({ clientId, ...document, cacheUntil: now + cacheSeconds * 1000, now });
      return toOAuthClient(oauthClientRepository.get(clientId)!);
    } catch (err) {
      console.warn(`[OAuth] Could not fetch client metadata document ${clientId}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  },

  touch(clientId: string, now: number = Date.now()): void {
    oauthClientRepository.touch(clientId, now);
  },
};
