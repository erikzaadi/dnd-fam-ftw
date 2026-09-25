import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getConfig, isAuthEnabled, isEmailAuthEnabled, isGoogleAuthConfigured } from '../config/env.js';
import type { AuthConfigResponse } from '../types.js';

export type JwtType = 'full' | 'pending-namespace' | 'pending-invite' | 'invite-requested';

export interface JwtPayload {
  email: string;
  namespaceId: string;
  type?: JwtType;
  // Stable user binding for full sessions. Older full tokens have no userId.
  userId?: string;
  // Issued-at (seconds), set by jsonwebtoken.
  iat?: number;
}

export interface GoogleIdentity {
  email: string;
  subject: string;
}

export function getAuthPublicConfig(): AuthConfigResponse {
  const config = getConfig();
  const enabled = isAuthEnabled();
  return {
    enabled,
    signupMode: config.SIGNUP_MODE,
    providers: {
      google: enabled && isGoogleAuthConfigured(),
      email: isEmailAuthEnabled(),
    },
  };
}

// PKCE (RFC 7636): the verifier stays in an HttpOnly cookie, Google only sees the challenge.
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function createOAuthState(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function buildGoogleAuthUrl(state: string, codeChallenge: string): string {
  const config = getConfig();
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID!,
    redirect_uri: config.GOOGLE_CALLBACK_URL!,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForIdentity(code: string, codeVerifier: string): Promise<GoogleIdentity> {
  const config = getConfig();
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID!,
      client_secret: config.GOOGLE_CLIENT_SECRET!,
      redirect_uri: config.GOOGLE_CALLBACK_URL!,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`[Auth] Token exchange failed: ${err}`);
  }

  const tokenData = await tokenRes.json() as { access_token: string; error?: string };
  if (tokenData.error) {
    throw new Error(`[Auth] Token error: ${tokenData.error}`);
  }

  const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    throw new Error(`[Auth] Failed to fetch user info`);
  }

  const userData = await userRes.json() as { email?: string; email_verified?: boolean; sub?: string };
  if (!userData.email || !userData.sub) {
    throw new Error(`[Auth] No email or subject in user info`);
  }
  if (userData.email_verified !== true) {
    throw new Error(`[Auth] Google email is not verified`);
  }

  return { email: userData.email, subject: userData.sub };
}

export function signJwt(payload: JwtPayload, shortLived: boolean = false): string {
  const config = getConfig();
  // Never copy a previous token's iat/exp into a new token.
  const { iat: _iat, ...claims } = payload;
  return jwt.sign(claims, config.JWT_SECRET!, { expiresIn: shortLived ? '10m' : '30d' });
}

export function verifyJwt(token: string): JwtPayload | null {
  const config = getConfig();
  try {
    return jwt.verify(token, config.JWT_SECRET!) as JwtPayload;
  } catch {
    return null;
  }
}
