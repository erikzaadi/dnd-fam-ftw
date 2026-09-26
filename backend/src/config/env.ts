import type { UsageTier } from '../types.js';

export type AppConfig = {
  SQLITE_DB_PATH: string;
  IMAGE_STORAGE_PROVIDER: 'local' | 's3';
  LOCAL_IMAGE_STORAGE_PATH: string;
  LOCAL_IMAGE_PUBLIC_BASE_URL: string;
  AWS_REGION?: string;
  S3_IMAGE_BUCKET?: string;
  S3_IMAGE_PREFIX: string;
  S3_IMAGE_PUBLIC_BASE_URL?: string;
  // Auth. AUTH_MODE defaults to 'enabled' when any legacy auth var is set, else 'disabled'.
  AUTH_MODE: AuthMode;
  SIGNUP_MODE: SignupMode;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_CALLBACK_URL?: string;
  JWT_SECRET?: string;
  ADMIN_EMAIL?: string;
  FRONTEND_URL?: string;
  APP_BASE_PATH: string;
  APP_VERSION: string;
  // Estimated AI spend per UTC day across all namespaces. Unset: no global limit.
  DAILY_SPEND_LIMIT_USD: number | null;
  // Email: sign-in codes and operator notifications. 'none' disables email sign-in.
  EMAIL_PROVIDER: EmailProviderName;
  EMAIL_FROM?: string;
  SES_REGION?: string;
  // Keyed hash for sign-in codes. Unset: derived from JWT_SECRET.
  EMAIL_CODE_HMAC_SECRET?: string;
  // New-signup notices go here. Defaults to ADMIN_EMAIL.
  SIGNUP_NOTIFY_EMAIL?: string;
  // Donation page (e.g. Ko-fi) shown in Your Realm. Unset hides the button.
  SUPPORT_URL: string | null;
  // Ko-fi webhook verification token (Ko-fi > Settings > API). Unset disables /webhooks/kofi.
  KOFI_VERIFICATION_TOKEN?: string;
  // MCP endpoint (/mcp) for AI assistants, invite-only pilot. Off by default and only
  // allowed with auth enabled. MCP_PUBLIC_URL is shown on the Access tokens page.
  MCP_ENABLED: boolean;
  MCP_PUBLIC_URL: string | null;
  // Paid MCP tool calls (previews, turns, questions, new adventures) per token per UTC
  // day, on top of the namespace's usage budget. 0 turns paid tools off, reads still work.
  MCP_DAILY_PAID_CALLS_PER_TOKEN: number;
  // Realm tiers whose members get MCP access without a per-user grant. A per-user
  // override (cli users mcp-access on|off) wins either way.
  MCP_DEFAULT_TIERS: UsageTier[];
  // Kill switch for member invitations (on by default when auth, email and
  // FRONTEND_URL are set). Disabled blocks sending, resending and accepting,
  // including links already sent.
  MEMBER_INVITES_DISABLED: boolean;
  // Invitation emails per UTC day across the deployment.
  INVITE_DAILY_SEND_CAP: number;
  // New accounts created by accepting invitations per UTC day. Joining with an
  // existing account does not count.
  INVITE_DAILY_ACCOUNT_CAP: number;
};

export type EmailProviderName = 'none' | 'ses' | 'capture';

export type AuthMode = 'disabled' | 'enabled';
export type SignupMode = 'invite_only' | 'open';

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = parse();
  }
  return _config;
}

// Tests that flip an env var after the config was first read.
export function resetConfigForTests(): void {
  _config = null;
}

export function isAuthEnabled(): boolean {
  return getConfig().AUTH_MODE === 'enabled';
}

export function isEmailConfigured(): boolean {
  const c = getConfig();
  if (c.EMAIL_PROVIDER === 'capture') {
    return true;
  }
  return c.EMAIL_PROVIDER === 'ses' && !!c.EMAIL_FROM && !!c.SES_REGION;
}

// Email sign-in needs auth enabled and a working email provider.
export function isEmailAuthEnabled(): boolean {
  return isAuthEnabled() && isEmailConfigured();
}

// MCP never inherits the anonymous 'local' namespace: assertAuthConfig refuses
// MCP_ENABLED without auth, and this check keeps the endpoint closed regardless.
export function isMcpEnabled(): boolean {
  const c = getConfig();
  return c.MCP_ENABLED && c.AUTH_MODE === 'enabled';
}

// Why member invitations are unavailable, or null when they are on. On by default:
// they need auth, an email provider (the same one as sign-in codes), and FRONTEND_URL,
// since links are built from configuration, never from the request Host.
export function memberInvitesUnavailableReason(): string | null {
  const c = getConfig();
  if (c.MEMBER_INVITES_DISABLED) {
    return 'MEMBER_INVITES_DISABLED=true';
  }
  if (c.AUTH_MODE !== 'enabled') {
    return 'auth is disabled';
  }
  if (!isEmailConfigured()) {
    return 'email is not configured (EMAIL_PROVIDER)';
  }
  if (!c.FRONTEND_URL) {
    return 'FRONTEND_URL is not set';
  }
  return null;
}

export function isGoogleAuthConfigured(): boolean {
  const c = getConfig();
  return !!(c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET && c.GOOGLE_CALLBACK_URL);
}

// Fail closed: with auth enabled, a missing secret or provider must stop startup
// instead of silently falling back to anonymous 'local' access.
export function assertAuthConfig(isProduction: boolean): void {
  const c = getConfig();
  if (c.AUTH_MODE === 'disabled') {
    if (c.MCP_ENABLED) {
      throw new Error('[Config] MCP_ENABLED=true requires AUTH_MODE=enabled. The MCP endpoint never allows anonymous access.');
    }
    return;
  }
  if (!c.JWT_SECRET) {
    throw new Error('[Config] AUTH_MODE=enabled requires JWT_SECRET. Set AUTH_MODE=disabled for local play without login.');
  }
  if (c.JWT_SECRET.length < 32) {
    if (isProduction) {
      throw new Error('[Config] JWT_SECRET must be at least 32 characters in production.');
    }
    console.warn('[Config] JWT_SECRET is shorter than 32 characters. Use a long random value outside local development.');
  }
  const partialGoogle = !!(c.GOOGLE_CLIENT_ID || c.GOOGLE_CLIENT_SECRET) && !isGoogleAuthConfigured();
  if (partialGoogle) {
    throw new Error('[Config] Google sign-in needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL.');
  }
  if (c.EMAIL_PROVIDER === 'ses' && !isEmailConfigured()) {
    throw new Error('[Config] EMAIL_PROVIDER=ses needs EMAIL_FROM and SES_REGION (or AWS_REGION).');
  }
  if (c.EMAIL_PROVIDER === 'capture' && isProduction) {
    throw new Error('[Config] EMAIL_PROVIDER=capture only prints mail and is not allowed in production.');
  }
  if (!isGoogleAuthConfigured() && !isEmailConfigured()) {
    throw new Error('[Config] AUTH_MODE=enabled requires at least one sign-in provider (Google or email). Set AUTH_MODE=disabled for local play without login.');
  }
  if (c.SIGNUP_MODE === 'open') {
    if (!isEmailConfigured()) {
      throw new Error('[Config] SIGNUP_MODE=open requires email (EMAIL_PROVIDER) for verification and signup notices.');
    }
    if (!c.SIGNUP_NOTIFY_EMAIL) {
      throw new Error('[Config] SIGNUP_MODE=open requires SIGNUP_NOTIFY_EMAIL or ADMIN_EMAIL for new-signup notices.');
    }
  }
}

// Exact browser origins allowed to make credentialed requests. Paths (APP_BASE_PATH)
// are not part of an origin. Requests without an Origin header (CLI, curl) are not
// affected by CORS and still need their own authentication. Outside production any
// localhost origin is allowed, since dev, E2E, and screenshot runs pick their own ports.
export function isAllowedOrigin(origin: string | undefined, isProduction: boolean): boolean {
  if (!origin || origin === 'null') {
    return false;
  }
  const c = getConfig();
  if ([c.FRONTEND_URL, c.GOOGLE_CALLBACK_URL].some(url => toOrigin(url) === origin)) {
    return true;
  }
  return !isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function toOrigin(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

function parseSupportUrl(): string | null {
  const raw = process.env.SUPPORT_URL?.trim();
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') {
      throw new Error('not https');
    }
    return url.href;
  } catch {
    throw new Error(`[Config] Invalid SUPPORT_URL: "${raw}". Must be an https URL.`);
  }
}

function parseNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`[Config] Invalid ${name}: "${raw}". Must be a whole number, 0 or more.`);
  }
  return value;
}

function parseBooleanFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return false;
  }
  if (raw === 'true' || raw === '1') {
    return true;
  }
  if (raw === 'false' || raw === '0') {
    return false;
  }
  throw new Error(`[Config] Invalid ${name}: "${process.env[name]}". Must be "true" or "false".`);
}

// https only, except plain http on loopback for local development.
function parseMcpPublicUrl(): string | null {
  const raw = process.env.MCP_PUBLIC_URL?.trim();
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new Error('not https');
    }
    return url.href;
  } catch {
    throw new Error(`[Config] Invalid MCP_PUBLIC_URL: "${raw}". Must be an https URL (http only on localhost).`);
  }
}

// Comma-separated tiers, e.g. "unlimited,supporter". Unset: unlimited only. Empty
// string or "none": no tier gets access by default.
function parseMcpDefaultTiers(): UsageTier[] {
  const raw = process.env.MCP_DEFAULT_TIERS;
  if (raw === undefined) {
    return ['unlimited'];
  }
  const known: readonly UsageTier[] = ['free', 'supporter', 'unlimited'];
  const values = raw.split(',').map(v => v.trim().toLowerCase()).filter(v => v && v !== 'none');
  const invalid = values.filter(v => !(known as readonly string[]).includes(v));
  if (invalid.length > 0) {
    throw new Error(`[Config] Invalid MCP_DEFAULT_TIERS: "${raw}". Use a comma-separated list of ${known.join(', ')}, or "none".`);
  }
  return known.filter(tier => values.includes(tier));
}

function parseEmailProvider(): EmailProviderName {
  const raw = process.env.EMAIL_PROVIDER?.trim();
  if (!raw) {
    return 'none';
  }
  if (raw !== 'none' && raw !== 'ses' && raw !== 'capture') {
    throw new Error(`[Config] Invalid EMAIL_PROVIDER: "${raw}". Must be "none", "ses", or "capture".`);
  }
  return raw;
}

function parseOptionalPositiveNumber(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`[Config] Invalid ${name}: "${raw}". Must be a positive number.`);
  }
  return value;
}

function parseAuthMode(): AuthMode {
  const raw = process.env.AUTH_MODE?.trim();
  if (!raw) {
    const legacyAuthVarSet = !!(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_SECRET || process.env.JWT_SECRET);
    return legacyAuthVarSet ? 'enabled' : 'disabled';
  }
  if (raw !== 'disabled' && raw !== 'enabled') {
    throw new Error(`[Config] Invalid AUTH_MODE: "${raw}". Must be "disabled" or "enabled".`);
  }
  return raw;
}

function parseSignupMode(): SignupMode {
  const raw = process.env.SIGNUP_MODE?.trim();
  if (!raw) {
    return 'invite_only';
  }
  if (raw !== 'invite_only' && raw !== 'open') {
    throw new Error(`[Config] Invalid SIGNUP_MODE: "${raw}". Must be "invite_only" or "open".`);
  }
  return raw;
}

function parse(): AppConfig {
  const IMAGE_STORAGE_PROVIDER = process.env.IMAGE_STORAGE_PROVIDER ?? 'local';
  if (IMAGE_STORAGE_PROVIDER !== 'local' && IMAGE_STORAGE_PROVIDER !== 's3') {
    throw new Error(`[Config] Invalid IMAGE_STORAGE_PROVIDER: "${IMAGE_STORAGE_PROVIDER}". Must be "local" or "s3".`);
  }
  return {
    SQLITE_DB_PATH: process.env.SQLITE_DB_PATH ?? './data/dnd-fam-ftw.sqlite',
    IMAGE_STORAGE_PROVIDER: IMAGE_STORAGE_PROVIDER as 'local' | 's3',
    LOCAL_IMAGE_STORAGE_PATH: process.env.LOCAL_IMAGE_STORAGE_PATH ?? './data/generated-images',
    LOCAL_IMAGE_PUBLIC_BASE_URL: process.env.LOCAL_IMAGE_PUBLIC_BASE_URL ?? '/generated',
    AWS_REGION: process.env.AWS_REGION,
    S3_IMAGE_BUCKET: process.env.S3_IMAGE_BUCKET,
    S3_IMAGE_PREFIX: process.env.S3_IMAGE_PREFIX ?? 'generated/',
    S3_IMAGE_PUBLIC_BASE_URL: process.env.S3_IMAGE_PUBLIC_BASE_URL,
    AUTH_MODE: parseAuthMode(),
    SIGNUP_MODE: parseSignupMode(),
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    FRONTEND_URL: process.env.FRONTEND_URL ?? '',
    APP_BASE_PATH: process.env.APP_BASE_PATH ?? '/',
    APP_VERSION: process.env.APP_VERSION ?? 'dev',
    DAILY_SPEND_LIMIT_USD: parseOptionalPositiveNumber('DAILY_SPEND_LIMIT_USD'),
    EMAIL_PROVIDER: parseEmailProvider(),
    EMAIL_FROM: process.env.EMAIL_FROM?.trim() || undefined,
    SES_REGION: process.env.SES_REGION?.trim() || process.env.AWS_REGION || undefined,
    EMAIL_CODE_HMAC_SECRET: process.env.EMAIL_CODE_HMAC_SECRET || undefined,
    SIGNUP_NOTIFY_EMAIL: process.env.SIGNUP_NOTIFY_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim() || undefined,
    SUPPORT_URL: parseSupportUrl(),
    KOFI_VERIFICATION_TOKEN: process.env.KOFI_VERIFICATION_TOKEN?.trim() || undefined,
    MCP_ENABLED: parseBooleanFlag('MCP_ENABLED'),
    MCP_PUBLIC_URL: parseMcpPublicUrl(),
    MCP_DAILY_PAID_CALLS_PER_TOKEN: parseNonNegativeInt('MCP_DAILY_PAID_CALLS_PER_TOKEN', 200),
    MCP_DEFAULT_TIERS: parseMcpDefaultTiers(),
    MEMBER_INVITES_DISABLED: parseBooleanFlag('MEMBER_INVITES_DISABLED'),
    INVITE_DAILY_SEND_CAP: parseNonNegativeInt('INVITE_DAILY_SEND_CAP', 200),
    INVITE_DAILY_ACCOUNT_CAP: parseNonNegativeInt('INVITE_DAILY_ACCOUNT_CAP', 25),
  };
}

// Turn pipeline strategy. 'resolved_first' (the default since 2026-09-25) settles the
// mechanics first and narrates from those facts, so the story always matches what
// happened. 'parallel' (the earlier default) runs narration beside the mechanics agents.
// Read on every call (not cached) so evaluations and tests can switch it.
export type TurnStrategy = 'parallel' | 'resolved_first';

export function getTurnStrategy(): TurnStrategy {
  const raw = process.env.AI_TURN_STRATEGY?.trim();
  if (!raw || raw === 'resolved_first') {
    return 'resolved_first';
  }
  if (raw === 'parallel') {
    return 'parallel';
  }
  throw new Error(`[Config] Invalid AI_TURN_STRATEGY: "${raw}". Must be "parallel" or "resolved_first".`);
}

