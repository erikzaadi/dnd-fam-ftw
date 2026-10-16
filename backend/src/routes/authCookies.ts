import type { Response } from 'express';
import type { JwtPayload } from '../services/authService.js';
import { fullTokenSeconds, signJwt } from '../services/authService.js';

const TEN_MINUTES_MS = 10 * 60 * 1000;

interface CookieOptions {
  isProduction: boolean;
}

const sessionCookieOptions = (maxAge: number, isProduction: boolean) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProduction,
  maxAge,
  path: '/',
});

// maxExpiresAt (epoch ms) caps a TV sign-in at its grant's hard end.
export const setFullAuthCookie = (res: Response, payload: JwtPayload, { isProduction, maxExpiresAt }: CookieOptions & { maxExpiresAt?: number }) => {
  res.cookie('jwt', signJwt(payload, false, maxExpiresAt), sessionCookieOptions(fullTokenSeconds(maxExpiresAt) * 1000, isProduction));
};

export const setPendingNamespaceCookie = (res: Response, payload: JwtPayload, { isProduction }: CookieOptions) => {
  res.cookie('jwt_pending', signJwt(payload, true), sessionCookieOptions(TEN_MINUTES_MS, isProduction));
};

export const setPendingInviteCookie = (res: Response, payload: JwtPayload, { isProduction }: CookieOptions) => {
  res.cookie('jwt_pending_invite', signJwt(payload, true), sessionCookieOptions(TEN_MINUTES_MS, isProduction));
};

const OAUTH_COOKIE = 'oauth_google';
export const EMAIL_CHALLENGE_COOKIE = 'email_challenge';
export const DEVICE_PAIRING_COOKIE = 'device_pairing';
const ALL_AUTH_COOKIES = ['jwt', 'jwt_pending', 'jwt_pending_invite', OAUTH_COOKIE, EMAIL_CHALLENGE_COOKIE, DEVICE_PAIRING_COOKIE];

// Binds an email sign-in code to the browser that asked for it. Only a hash is stored.
export const setEmailChallengeCookie = (res: Response, browserToken: string, { isProduction }: CookieOptions) => {
  res.cookie(EMAIL_CHALLENGE_COOKIE, browserToken, sessionCookieOptions(TEN_MINUTES_MS + 60 * 1000, isProduction));
};

// Binds a TV pairing to the TV that started it. Only a hash is stored. Outlives the
// code by a minute so a poll right at expiry still gets a clear answer.
export const setDevicePairingCookie = (res: Response, deviceToken: string, { isProduction }: CookieOptions) => {
  res.cookie(DEVICE_PAIRING_COOKIE, deviceToken, sessionCookieOptions(TEN_MINUTES_MS + 60 * 1000, isProduction));
};

// Browser-bound OAuth state and PKCE verifier, consumed once by the callback.
// SameSite=Lax still sends it on Google's top-level redirect back to the callback.
export const setOAuthCookie = (res: Response, state: string, verifier: string, { isProduction }: CookieOptions) => {
  res.cookie(OAUTH_COOKIE, `${state}.${verifier}`, sessionCookieOptions(TEN_MINUTES_MS, isProduction));
};

export const readOAuthCookie = (cookies: Record<string, string> | undefined): { state: string; verifier: string } | null => {
  const [state, verifier, ...rest] = (cookies?.[OAUTH_COOKIE] ?? '').split('.');
  if (!state || !verifier || rest.length > 0) {
    return null;
  }
  return { state, verifier };
};

export const clearOAuthCookie = (res: Response) => {
  res.clearCookie(OAUTH_COOKIE, { path: '/' });
};

// Pending cookies left over from an earlier attempt must not linger after sign-in.
export const clearPendingAuthCookies = (res: Response) => {
  res.clearCookie('jwt_pending', { path: '/' });
  res.clearCookie('jwt_pending_invite', { path: '/' });
  res.clearCookie(EMAIL_CHALLENGE_COOKIE, { path: '/' });
  clearOAuthCookie(res);
};

export const clearAllAuthCookies = (res: Response) => {
  for (const name of ALL_AUTH_COOKIES) {
    res.clearCookie(name, { path: '/' });
  }
};
