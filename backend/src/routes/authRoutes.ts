import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { getConfig, isAllowedOrigin, isAuthEnabled, isEmailAuthEnabled, isGoogleAuthConfigured } from '../config/env.js';
import { resendEmailCode, startEmailSignIn, verifyEmailCode } from '../services/emailAuthService.js';
import { dispatchOutbox, enqueueInviteRequestNotice } from '../services/emailService.js';
import { resolveGoogleSignIn, type SignInOutcome } from '../services/signupService.js';
import { authMiddleware, requireFullIdentity, requirePendingInviteToken, requirePendingNamespaceToken } from '../middleware/auth.js';
import { buildGoogleAuthUrl, createOAuthState, createPkcePair, exchangeCodeForIdentity, getAuthPublicConfig, safeEqual } from '../services/authService.js';
import { StateService } from '../services/stateService.js';
import { isNamespaceOwner } from '../services/namespaceOwnershipService.js';
import { canInvite } from '../services/namespaceInviteService.js';
import {
  EMAIL_CHALLENGE_COOKIE,
  clearAllAuthCookies,
  clearOAuthCookie,
  clearPendingAuthCookies,
  readOAuthCookie,
  setFullAuthCookie,
  setOAuthCookie,
  setPendingInviteCookie,
  setEmailChallengeCookie,
  setPendingNamespaceCookie,
} from './authCookies.js';
import type {
  AuthMeResponse,
  EmailSignInErrorResponse,
  EmailSignInResendResponse,
  EmailSignInStartResponse,
  EmailSignInVerifyResponse,
  SessionNamespacesResponse,
} from '../types.js';
import { parseBody } from './routeValidation.js';
import { requireBrowserJsonPost } from './browserPost.js';

interface AuthRoutesOptions {
  isProduction: boolean;
}

const selectNamespaceBodySchema = z.object({
  namespaceId: z.string().min(1),
});

const requestInviteBodySchema = z.object({
  message: z.string().optional(),
});

const emailStartBodySchema = z.object({
  email: z.string().max(320),
});

const emailVerifyBodySchema = z.object({
  challengeId: z.string().min(1).max(64),
  code: z.string().max(32),
});

const emailResendBodySchema = z.object({
  challengeId: z.string().min(1).max(64),
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

  // Shared by Google and email sign-in: issue the right cookie for a verified email
  // and return where the app should go next.
  const completeSignIn = (res: Response, outcome: SignInOutcome): EmailSignInVerifyResponse['next'] => {
    if (outcome.kind === 'pick-namespace') {
      setPendingNamespaceCookie(res, { email: outcome.email, namespaceId: '', type: 'pending-namespace' }, { isProduction });
      return '/namespace-picker';
    }
    if (outcome.kind === 'invite') {
      console.warn(`[Auth] Sign-in without an account (signup ${config.SIGNUP_MODE}): ${outcome.email}`);
      const type = outcome.alreadyRequested ? 'invite-requested' : 'pending-invite';
      setPendingInviteCookie(res, { email: outcome.email, namespaceId: '', type }, { isProduction });
      return '/request-invite';
    }
    StateService.recordLogin(outcome.email);
    clearPendingAuthCookies(res);
    setFullAuthCookie(res, { email: outcome.email, namespaceId: outcome.namespaceId, type: 'full', userId: outcome.userId }, { isProduction });
    if (outcome.created) {
      void dispatchOutbox();
    }
    return '/';
  };

  const emailError = (res: Response, status: number, body: EmailSignInErrorResponse) => {
    res.status(status).json(body);
  };

  const requireEmailAuth = (_req: Request, res: Response, next: NextFunction) => {
    if (!isEmailAuthEnabled()) {
      res.status(404).json({ error: 'Email sign-in not configured' });
      return;
    }
    next();
  };

  router.post('/auth/email/start', requireEmailAuth, asyncHandler(async (req, res) => {
    const body = parseBody(req, res, emailStartBodySchema);
    if (!body) {
      return;
    }
    const result = await startEmailSignIn(body.email, req.ip ?? 'unknown');
    if (result.status === 'invalid_email') {
      emailError(res, 400, { error: 'invalid_email' });
      return;
    }
    if (result.status === 'rate_limited') {
      emailError(res, 429, { error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds });
      return;
    }
    if (result.status === 'unavailable') {
      emailError(res, 503, { error: 'email_unavailable' });
      return;
    }
    setEmailChallengeCookie(res, result.browserToken, { isProduction });
    const response: EmailSignInStartResponse = {
      challengeId: result.challengeId,
      maskedEmail: result.maskedEmail,
      resendAfterSeconds: result.resendAfterSeconds,
      expiresInSeconds: result.expiresInSeconds,
    };
    res.status(202).json(response);
  }));

  router.post('/auth/email/verify', requireEmailAuth, (req, res) => {
    const body = parseBody(req, res, emailVerifyBodySchema);
    if (!body) {
      return;
    }
    const browserToken = (req.cookies as Record<string, string> | undefined)?.[EMAIL_CHALLENGE_COOKIE];
    const result = verifyEmailCode(body.challengeId, body.code, browserToken, req.ip ?? 'unknown');
    if (result.status === 'invalid_code') {
      emailError(res, 400, { error: 'invalid_code', attemptsLeft: result.attemptsLeft });
      return;
    }
    if (result.status === 'rate_limited') {
      emailError(res, 429, { error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds });
      return;
    }
    if (result.status === 'expired') {
      emailError(res, 410, { error: 'expired' });
      return;
    }
    res.clearCookie(EMAIL_CHALLENGE_COOKIE, { path: '/' });
    const response: EmailSignInVerifyResponse = { next: completeSignIn(res, result.outcome) };
    res.json(response);
  });

  router.post('/auth/email/resend', requireEmailAuth, asyncHandler(async (req, res) => {
    const body = parseBody(req, res, emailResendBodySchema);
    if (!body) {
      return;
    }
    const browserToken = (req.cookies as Record<string, string> | undefined)?.[EMAIL_CHALLENGE_COOKIE];
    const result = await resendEmailCode(body.challengeId, browserToken, req.ip ?? 'unknown');
    if (result.status === 'expired') {
      emailError(res, 410, { error: 'expired' });
      return;
    }
    if (result.status === 'rate_limited') {
      emailError(res, 429, { error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds });
      return;
    }
    if (result.status === 'unavailable') {
      emailError(res, 503, { error: 'email_unavailable' });
      return;
    }
    const response: EmailSignInResendResponse = { resendAfterSeconds: result.resendAfterSeconds, expiresInSeconds: result.expiresInSeconds };
    res.json(response);
  }));

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
    const outcome = resolveGoogleSignIn(email);
    if (outcome.kind === 'use-email-code') {
      res.redirect(`${config.FRONTEND_URL ?? ''}${config.APP_BASE_PATH}login?error=use_email_code`);
      return;
    }
    const next = completeSignIn(res, outcome);
    res.redirect(`${config.FRONTEND_URL ?? ''}${config.APP_BASE_PATH}${next.slice(1)}`);
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
  
  // Realm switching for an already signed-in user. Uses the identity-only check so a
  // user removed from their active realm can still list and pick another membership.
  router.get('/auth/session/namespaces', requireFullIdentity, (req, res) => {
    const identity = req.fullIdentity!;
    const namespaces = StateService.getUserNamespaces(identity.email)
      .map(namespace => ({ ...namespace, isOwner: isNamespaceOwner(identity.userId, namespace.id) }));
    const currentNamespaceId = namespaces.some(n => n.id === identity.namespaceId) ? identity.namespaceId : null;
    const body: SessionNamespacesResponse = {
      currentNamespaceId,
      namespaces,
      canInvite: currentNamespaceId !== null && canInvite(identity.userId, currentNamespaceId),
    };
    res.json(body);
  });

  router.post('/auth/session/namespace', requireBrowserJsonPost(isProduction), requireFullIdentity, (req, res) => {
    const body = parseBody(req, res, selectNamespaceBodySchema);
    if (!body) {
      return;
    }
    const identity = req.fullIdentity!;
    // Fresh membership lookup: the target must be a membership right now.
    if (!StateService.getUserNamespaces(identity.email).some(n => n.id === body.namespaceId)) {
      res.status(403).json({ error: 'Namespace access denied' });
      return;
    }
    setFullAuthCookie(res, { email: identity.email, namespaceId: body.namespaceId, type: 'full', userId: identity.userId }, { isProduction });
    res.json({ ok: true });
  });

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
    enqueueInviteRequestNotice({ email: req.pendingPayload!.email, message: message?.trim() || null, requestedAt: new Date() });
    void dispatchOutbox();
    res.clearCookie('jwt_pending_invite', { path: '/' });
    res.json({ ok: true });
  }));

  return router;
};
