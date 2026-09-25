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
};

export type AuthMode = 'disabled' | 'enabled';
export type SignupMode = 'invite_only' | 'open';

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = parse();
  }
  return _config;
}

export function isAuthEnabled(): boolean {
  return getConfig().AUTH_MODE === 'enabled';
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
  if (!isGoogleAuthConfigured()) {
    throw new Error('[Config] AUTH_MODE=enabled requires at least one sign-in provider (Google). Set AUTH_MODE=disabled for local play without login.');
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

