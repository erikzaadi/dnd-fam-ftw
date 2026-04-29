import type { Response } from 'express';
import type { JwtPayload } from '../services/authService.js';
import { signJwt } from '../services/authService.js';

const TEN_MINUTES_MS = 10 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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

export const setFullAuthCookie = (res: Response, payload: JwtPayload, { isProduction }: CookieOptions) => {
  res.cookie('jwt', signJwt(payload), sessionCookieOptions(THIRTY_DAYS_MS, isProduction));
};

export const setPendingNamespaceCookie = (res: Response, payload: JwtPayload, { isProduction }: CookieOptions) => {
  res.cookie('jwt_pending', signJwt(payload, true), sessionCookieOptions(TEN_MINUTES_MS, isProduction));
};

export const setPendingInviteCookie = (res: Response, payload: JwtPayload, { isProduction }: CookieOptions) => {
  res.cookie('jwt_pending_invite', signJwt(payload, true), sessionCookieOptions(TEN_MINUTES_MS, isProduction));
};
