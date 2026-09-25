import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { getConfig, isAllowedOrigin, isAuthEnabled, isGoogleAuthConfigured } from '../config/env.js';
import { authMiddleware, requirePendingInviteToken, requirePendingNamespaceToken } from '../middleware/auth.js';
import { buildGoogleAuthUrl, createOAuthState, createPkcePair, exchangeCodeForIdentity, getAuthPublicConfig, safeEqual } from '../services/authService.js';
import { StateService } from '../services/stateService.js';
import {
  clearAllAuthCookies,
  clearOAuthCookie,
  clearPendingAuthCookies,
  readOAuthCookie,
  setFullAuthCookie,
  setOAuthCookie,
  setPendingInviteCookie,
  setPendingNamespaceCookie,
} from './authCookies.js';
import type { AuthMeResponse } from '../types.js';
import { parseBody } from './routeValidation.js';

interface AuthRoutesOptions {
  isProduction: boolean;
}

const selectNamespaceBodySchema = z.object({
  namespaceId: z.string().min(1),
});

const requestInviteBodySchema = z.object({
  message: z.string().optional(),
});

export const createAuthRouter = ({ isProduction }: AuthRoutesOptions) => {
  const router = Router();
  const config = getConfig();
  const loginErrorUrl = () => `${config.FRONTEND_URL ?? ''}${config.APP_BASE_PATH}login?error=oauth`;

  // State-changing auth requests from a browser must come from our own frontend.
  // CORS alone does not stop a cross-site form POST from being sent.
  const requireAllowedOrigin = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.get('origin');
    if (origin !== undefined && !isAllowedOrigin(origin, isProduction)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    next();
  };
  router.post('/auth/*path', requireAllowedOrigin);

  router.get('/auth/config', (_req, res) => {
    res.json(getAuthPublicConfig());
  });
  
  router.get('/auth/me', (req, res, next) => authMiddleware(req, res, next), (req, res) => {
    const body: AuthMeResponse = isAuthEnabled()
      ? { enabled: true, email: req.userEmail, namespaceId: req.namespaceId }
      : { enabled: false, email: null, namespaceId: 'local' };
    res.json(body);
  });
  
  router.get('/auth/google', (_req, res) => {
    if (!isAuthEnabled() || !isGoogleAuthConfigured()) {
      res.status(404).json({ error: 'Auth not configured' });
      return;
    }
    const state = createOAuthState();
    const pkce = createPkcePair();
    setOAuthCookie(res, state, pkce.verifier, { isProduction });
    const url = buildGoogleAuthUrl(state, pkce.challenge);
    console.log(`[Auth] Redirecting to Google OAuth`);
    res.redirect(url);
  });
  
  router.get('/auth/google/callback', asyncHandler(async (req, res) => {
    console.log(`[Auth] Callback hit - query keys: ${Object.keys(req.query).join(', ')}`);
    if (!isAuthEnabled() || !isGoogleAuthConfigured()) {
      res.status(404).json({ error: 'Auth not configured' });
      return;
    }

    // The state/verifier cookie is single use, whatever the outcome.
    const oauth = readOAuthCookie(req.cookies as Record<string, string> | undefined);
    clearOAuthCookie(res);

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const error = req.query.error;
    if (error) {
      console.log(`[Auth] Google returned error: ${String(error)}`);
      res.redirect(loginErrorUrl());
      return;
    }
    if (!code || !oauth || !state || !safeEqual(state, oauth.state)) {
      console.warn('[Auth] Rejected Google callback: missing or mismatched state');
      res.redirect(loginErrorUrl());
      return;
    }

    let email: string;
    try {
      ({ email } = await exchangeCodeForIdentity(code, oauth.verifier));
    } catch (err) {
      console.warn(`[Auth] Google sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
      res.redirect(loginErrorUrl());
      return;
    }
    const user = StateService.getUserByEmail(email);
    const frontendUrl = config.FRONTEND_URL ?? '';
    const basePath = config.APP_BASE_PATH;
  
    if (!user) {
      // User is a real Google account but not registered - issue pending-invite or invite-requested JWT
      console.warn(`[Auth] Login denied for unregistered email: ${email}`);
      const alreadyRequested = StateService.hasInviteRequest(email);
      const jwtType = alreadyRequested ? 'invite-requested' : 'pending-invite';
      setPendingInviteCookie(res, { email, namespaceId: '', type: jwtType }, { isProduction });
      res.redirect(`${frontendUrl}${basePath}request-invite`);
      return;
    }
  
    const namespaces = StateService.getUserNamespaces(email);
    console.log(`[Auth] Login for ${email}: found ${namespaces.length} namespace(s): ${namespaces.map(n => n.name).join(', ')}`);
    if (namespaces.length > 1) {
      // User has multiple namespaces - issue pending-namespace JWT and show picker
      setPendingNamespaceCookie(res, { email, namespaceId: '', type: 'pending-namespace' }, { isProduction });
      res.redirect(`${frontendUrl}${basePath}namespace-picker`);
      return;
    }
  
    const namespaceId = namespaces[0]?.id ?? user.namespace_id;
    StateService.recordLogin(email);
    clearPendingAuthCookies(res);
    setFullAuthCookie(res, { email: user.email, namespaceId, type: 'full', userId: user.id }, { isProduction });
  
    res.redirect(`${frontendUrl}${basePath}`);
  }));
  
  router.post('/auth/logout', (_req, res) => {
    clearAllAuthCookies(res);
    res.json({ ok: true });
  });
  
  router.get('/auth/namespaces', requirePendingNamespaceToken, (req, res) => {
    const namespaces = StateService.getUserNamespaces(req.pendingPayload!.email);
    res.json({ namespaces });
  });
  
  router.post('/auth/select-namespace', requirePendingNamespaceToken, asyncHandler(async (req, res) => {
    const body = parseBody(req, res, selectNamespaceBodySchema);
    if (!body) {
      return;
    }
    const { namespaceId } = body;
    const user = StateService.getUserByEmail(req.pendingPayload!.email);
    const namespaces = StateService.getUserNamespaces(req.pendingPayload!.email);
    if (!user || !namespaces.some(n => n.id === namespaceId)) {
      res.status(403).json({ error: 'Namespace access denied' });
      return;
    }
    clearPendingAuthCookies(res);
    StateService.recordLogin(user.email);
    setFullAuthCookie(res, { email: user.email, namespaceId, type: 'full', userId: user.id }, { isProduction });
    res.json({ ok: true });
  }));
  
  router.get('/auth/invite-info', requirePendingInviteToken, (req, res) => {
    res.json({ email: req.pendingPayload!.email, alreadyRequested: req.pendingPayload!.type === 'invite-requested' });
  });
  
  router.post('/auth/request-invite', requirePendingInviteToken, asyncHandler(async (req, res) => {
    if (req.pendingPayload!.type !== 'pending-invite') {
      res.status(403).json({ error: 'Invalid token or invite already submitted' });
      return;
    }
    const body = parseBody(req, res, requestInviteBodySchema);
    if (!body) {
      return;
    }
    const { message } = body;
    StateService.addInviteRequest(req.pendingPayload!.email, message);
    res.clearCookie('jwt_pending_invite', { path: '/' });
    res.json({ ok: true });
  }));

  return router;
};
