import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { getConfig, isAuthEnabled } from '../config/env.js';
import { createId } from '../lib/ids.js';
import { authMiddleware, requirePendingInviteToken, requirePendingNamespaceToken } from '../middleware/auth.js';
import { buildGoogleAuthUrl, exchangeCodeForEmail, getAuthPublicConfig } from '../services/authService.js';
import { StateService } from '../services/stateService.js';
import { setFullAuthCookie, setPendingInviteCookie, setPendingNamespaceCookie } from './authCookies.js';
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

  router.get('/auth/config', (_req, res) => {
    res.json(getAuthPublicConfig());
  });
  
  router.get('/auth/me', (req, res, next) => authMiddleware(req, res, next), (req, res) => {
    if (!isAuthEnabled()) {
      res.json({ enabled: false, email: null, namespaceId: 'local' });
      return;
    }
    res.json({ enabled: true, email: req.userEmail, namespaceId: req.namespaceId });
  });
  
  router.get('/auth/google', (_req, res) => {
    if (!isAuthEnabled()) {
      res.status(404).json({ error: 'Auth not configured' });
      return;
    }
    const state = createId();
    const url = buildGoogleAuthUrl(state);
    console.log(`[Auth] Redirecting to Google OAuth`);
    res.redirect(url);
  });
  
  router.get('/auth/google/callback', asyncHandler(async (req, res) => {
    console.log(`[Auth] Callback hit - query keys: ${Object.keys(req.query).join(', ')}`);
    if (!isAuthEnabled()) {
      res.status(404).json({ error: 'Auth not configured' });
      return;
    }
  
    const code = req.query.code as string;
    const error = req.query.error as string | undefined;
    if (error) {
      console.log(`[Auth] Google returned error: ${error}`);
      res.redirect(`${config.FRONTEND_URL ?? ''}${config.APP_BASE_PATH}login?error=oauth`);
      return;
    }
    if (!code) {
      res.status(400).json({ error: 'Missing code' });
      return;
    }
  
    const email = await exchangeCodeForEmail(code);
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
    setFullAuthCookie(res, { email: user.email, namespaceId, type: 'full' }, { isProduction });
  
    res.redirect(`${frontendUrl}${basePath}`);
  }));
  
  router.post('/auth/logout', (_req, res) => {
    res.clearCookie('jwt', { path: '/' });
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
    const namespaces = StateService.getUserNamespaces(req.pendingPayload!.email);
    if (!namespaces.some(n => n.id === namespaceId)) {
      res.status(403).json({ error: 'Namespace access denied' });
      return;
    }
    res.clearCookie('jwt_pending', { path: '/' });
    setFullAuthCookie(res, { email: req.pendingPayload!.email, namespaceId, type: 'full' }, { isProduction });
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
