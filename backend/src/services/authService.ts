import jwt from 'jsonwebtoken';
import { getConfig, isAuthEnabled } from '../config/env.js';

export interface JwtPayload {
  email: string;
  namespaceId: string;
}

export function getAuthPublicConfig(): { enabled: boolean; googleClientId?: string } {
  const config = getConfig();
  return {
    enabled: isAuthEnabled(),
    googleClientId: config.GOOGLE_CLIENT_ID,
  };
}

export function buildGoogleAuthUrl(state: string): string {
  const config = getConfig();
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID!,
    redirect_uri: config.GOOGLE_CALLBACK_URL!,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForEmail(code: string): Promise<string> {
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

  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    throw new Error(`[Auth] Failed to fetch user info`);
  }

  const userData = await userRes.json() as { email: string };
  if (!userData.email) {
    throw new Error(`[Auth] No email in user info`);
  }

  return userData.email;
}

export function signJwt(payload: JwtPayload): string {
  const config = getConfig();
  return jwt.sign(payload, config.JWT_SECRET!, { expiresIn: '30d' });
}

export function verifyJwt(token: string): JwtPayload | null {
  const config = getConfig();
  try {
    return jwt.verify(token, config.JWT_SECRET!) as JwtPayload;
  } catch {
    return null;
  }
}
